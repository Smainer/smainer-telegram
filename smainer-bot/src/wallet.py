"""Starknet wallet linking and $STRK balance verification.

Serverless edition: wallet links are stored via the Relayer KV API
(backed by the relayer's own Redis). No direct Redis dependency.
"""

import logging
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)


class BalanceUnavailableError(Exception):
    """Raised when the Starknet RPC is unreachable and balance cannot be verified."""


class WalletManager:
    """Manages user wallet links and $STRK balance checks.

    Uses the Relayer's /api/v1/bot/kv/ endpoints for persistence.
    """

    def __init__(self, kv_client) -> None:
        self._kv = kv_client  # RelayerKVClient
        self._starknet = None  # Lazy-loaded to avoid cold start penalty

    # ------------------------------------------------------------------
    # Wallet linking
    # ------------------------------------------------------------------

    async def link_wallet(self, user_id: int, starknet_address: str) -> None:
        """Store the user ↔ Starknet address mapping via Relayer KV."""
        normalized = self._normalize_address(starknet_address)
        await self._kv.kv_set(f"wallet:{user_id}", normalized)
        logger.info("Wallet linked", extra={"user_id": user_id})

    async def unlink_wallet(self, user_id: int) -> None:
        """Remove the user's wallet link."""
        await self._kv.kv_delete(f"wallet:{user_id}")

    async def get_linked_address(self, user_id: int) -> Optional[str]:
        """Return the linked Starknet address, or None if not linked."""
        return await self._kv.kv_get(f"wallet:{user_id}")

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
