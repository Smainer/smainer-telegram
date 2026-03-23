"""Starknet wallet linking and $STRK balance verification.

Serverless edition: Redis client is created per invocation (Upstash TLS).
Wallet links are stored in Redis under tgbot:wallet:{user_id}.
"""

import logging
from typing import Optional

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)

_WALLET_KEY = "tgbot:wallet:{user_id}"


class BalanceUnavailableError(Exception):
    """Raised when the Starknet RPC is unreachable and balance cannot be verified."""


class WalletManager:
    """Manages user wallet links and $STRK balance checks.

    Args:
        redis: An async Redis client connected to Upstash (or local Redis).
    """

    def __init__(self, redis: aioredis.Redis) -> None:
        self._redis = redis
        self._starknet = None  # Lazy-loaded to avoid cold start penalty

    # ------------------------------------------------------------------
    # Wallet linking
    # ------------------------------------------------------------------

    async def link_wallet(self, user_id: int, starknet_address: str) -> None:
        """Store the user ↔ Starknet address mapping in Redis."""
        normalized = self._normalize_address(starknet_address)
        await self._redis.hset(
            _WALLET_KEY.format(user_id=user_id),
            mapping={"address": normalized},
        )
        logger.info("Wallet linked", extra={"user_id": user_id})

    async def unlink_wallet(self, user_id: int) -> None:
        """Remove the user's wallet link from Redis."""
        await self._redis.delete(_WALLET_KEY.format(user_id=user_id))

    async def get_linked_address(self, user_id: int) -> Optional[str]:
        """Return the linked Starknet address, or None if not linked."""
        raw = await self._redis.hget(_WALLET_KEY.format(user_id=user_id), "address")
        if raw is None:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw

    # ------------------------------------------------------------------
    # Balance
    # ------------------------------------------------------------------

    async def get_strk_balance(self, starknet_address: str) -> int:
        """Query on-chain $STRK balance; returns value in wei.

        Raises:
            BalanceUnavailableError: When the Starknet RPC cannot be reached.
        """
        try:
            # Lazy-load starknet-py to avoid ~50MB import on cold start
            from starknet_py.contract import Contract
            from starknet_py.net.full_node_client import FullNodeClient

            if self._starknet is None:
                self._starknet = FullNodeClient(node_url=settings.starknet_rpc_url)

            token_addr = int(settings.strk_token_address, 16)
            contract = await Contract.from_address(
                address=token_addr,
                provider=self._starknet,
            )
            user_addr = int(self._normalize_address(starknet_address), 16)
            (balance,) = await contract.functions["balance_of"].call(user_addr)
            return int(balance)
        except Exception as exc:
            logger.error(
                "Balance check failed",
                extra={
                    "error": type(exc).__name__,
                    "rpc": settings.starknet_rpc_url,
                },
            )
            raise BalanceUnavailableError(
                f"Cannot reach Starknet RPC at {settings.starknet_rpc_url}"
            ) from exc

    async def has_sufficient_balance(self, starknet_address: str) -> bool:
        """Return True if the wallet holds at least MIN_STRK_BALANCE."""
        balance = await self.get_strk_balance(starknet_address)
        return balance >= settings.min_strk_balance

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_address(address: str) -> str:
        """Normalise a Starknet address to lowercase 0x-prefixed hex."""
        stripped = address.strip().lower()
        if not stripped.startswith("0x"):
            raise ValueError(f"Invalid Starknet address (must start with 0x): {address!r}")
        # Validate hex characters
        hex_part = stripped[2:]
        if not all(c in "0123456789abcdef" for c in hex_part):
            raise ValueError(f"Invalid hex characters in address: {address!r}")
        # Pad to 64 hex chars after the 0x prefix (Starknet addresses are 251 bits)
        return "0x" + hex_part.zfill(64)
