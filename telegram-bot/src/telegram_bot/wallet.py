"""Starknet wallet linking and $STRK balance verification."""

import logging
from typing import Optional

import redis.asyncio as aioredis
from starknet_py.contract import Contract
from starknet_py.net.full_node_client import FullNodeClient

from .config import settings

logger = logging.getLogger(__name__)

# Redis key schema
_WALLET_KEY = "tgbot:wallet:{user_id}"


class WalletManager:
    """Links Telegram users to Starknet addresses and checks $STRK balances."""

    def __init__(self, redis: aioredis.Redis) -> None:
        self._redis = redis
        self._client = FullNodeClient(node_url=settings.starknet_rpc_url)

    # ------------------------------------------------------------------
    # Linking
    # ------------------------------------------------------------------

    async def link_wallet(self, user_id: int, starknet_address: str) -> None:
        """Store the user ↔ wallet association in Redis."""
        # Basic hex validation
        normalized = self._normalize_address(starknet_address)
        await self._redis.hset(
            _WALLET_KEY.format(user_id=user_id),
            mapping={"address": normalized},
        )
        logger.info("Wallet linked", extra={"user_id": user_id, "address": normalized})

    async def unlink_wallet(self, user_id: int) -> None:
        """Remove wallet link."""
        await self._redis.delete(_WALLET_KEY.format(user_id=user_id))

    async def get_linked_address(self, user_id: int) -> Optional[str]:
        """Return the linked Starknet address or None."""
        addr = await self._redis.hget(_WALLET_KEY.format(user_id=user_id), "address")
        return addr if addr else None

    # ------------------------------------------------------------------
    # Balance
    # ------------------------------------------------------------------

    async def get_strk_balance(self, starknet_address: str) -> int:
        """Query on-chain $STRK balance (returns wei)."""
        try:
            normalized = self._normalize_address(starknet_address)
            contract = await Contract.from_address(
                address=int(normalized, 16),
                provider=self._client,
            )
            (balance,) = await contract.functions["balance_of"].call(
                int(normalized, 16)
            )
            return int(balance)
        except Exception:
            # If we can't reach the chain, try calling the ERC-20 directly
            return await self._raw_balance_of(starknet_address)

    async def has_sufficient_balance(self, user_id: int) -> bool:
        """Check if the linked wallet meets the minimum $STRK balance."""
        address = await self.get_linked_address(user_id)
        if not address:
            return False
        balance = await self.get_strk_balance(address)
        return balance >= settings.min_strk_balance

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _raw_balance_of(self, starknet_address: str) -> int:
        """Direct low-level call to balanceOf on the $STRK token contract."""
        try:
            token_addr = int(settings.strk_token_address, 16)
            contract = await Contract.from_address(
                address=token_addr,
                provider=self._client,
            )
            user_addr = int(self._normalize_address(starknet_address), 16)
            (balance,) = await contract.functions["balance_of"].call(user_addr)
            return int(balance)
        except Exception as exc:
            logger.error("Failed to check balance", extra={"error": str(exc)})
            return 0

    @staticmethod
    def _normalize_address(address: str) -> str:
        """Normalize a Starknet address to 0x-prefixed lowercase hex."""
        addr = address.strip().lower()
        if not addr.startswith("0x"):
            addr = "0x" + addr
        # Validate hex
        int(addr, 16)
        return addr
