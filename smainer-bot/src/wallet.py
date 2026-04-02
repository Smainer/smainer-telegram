"""Starknet wallet linking and $STRK balance verification.

Serverless edition: wallet links are stored via the Relayer KV API
(backed by the relayer's own Redis). No direct Redis dependency.

TM-001: Uses HMAC-keyed KV keys and optional Fernet encryption for
privacy-hardened wallet address persistence.

Migration: when WALLET_HMAC_KEY / WALLET_ENCRYPTION_KEY are first
enabled, reads fall back to legacy ``wallet:{user_id}`` + plaintext
values.  On a successful legacy read the value is transparently
re-written to the new format and the old key is deleted.
"""

import logging
from typing import Optional

from .config import settings
from .wallet_crypto import (
    decrypt_address,
    derive_wallet_key,
    encrypt_address,
    is_hmac_key_active,
    plain_wallet_key,
)

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
        """Store the user ↔ Starknet address mapping via Relayer KV.

        Uses HMAC-keyed KV key and optional Fernet encryption (TM-001).
        """
        normalized = self._normalize_address(starknet_address)
        kv_key = derive_wallet_key(user_id)
        encrypted = encrypt_address(normalized)
        await self._kv.kv_set(kv_key, encrypted)
        if settings.telemetry_sensitive_fields:
            logger.info("Wallet linked", extra={"user_id": user_id})
        else:
            logger.info("Wallet linked for user")

    async def unlink_wallet(self, user_id: int) -> None:
        """Remove the user's wallet link (both new and legacy keys)."""
        kv_key = derive_wallet_key(user_id)
        await self._kv.kv_delete(kv_key)
        # Also clean up a possible legacy key so no stale data remains.
        legacy_key = plain_wallet_key(user_id)
        if legacy_key != kv_key:
            await self._kv.kv_delete(legacy_key)

    async def get_linked_address(self, user_id: int) -> Optional[str]:
        """Return the linked Starknet address, or None if not linked.

        Migration path:
        1. Try the current (possibly HMAC-keyed) KV key.
        2. If not found **and** HMAC keys are active, fall back to the
           legacy ``wallet:{user_id}`` key.
        3. On a successful legacy read, re-write to the new key/value
           format and delete the old key (transparent migration).
        """
        kv_key = derive_wallet_key(user_id)
        stored = await self._kv.kv_get(kv_key)

        if stored is not None:
            return decrypt_address(stored)

        # -- Legacy fallback (only when key format has actually changed) --
        legacy_key = plain_wallet_key(user_id)
        if legacy_key == kv_key:
            # Key format hasn't changed → nothing to fall back to.
            return None

        legacy_stored = await self._kv.kv_get(legacy_key)
        if legacy_stored is None:
            return None

        address = decrypt_address(legacy_stored)
        if address is None:
            # Truly corrupted — can't migrate.
            return None

        # Transparently migrate: write new format, remove legacy key.
        try:
            encrypted = encrypt_address(address)
            await self._kv.kv_set(kv_key, encrypted)
            await self._kv.kv_delete(legacy_key)
            logger.info("Wallet migrated to new key format")
        except Exception:
            # Migration write failed — still return the address so the
            # user isn't blocked.  Next read will retry the migration.
            logger.warning("Wallet migration write failed; will retry on next read")

        return address

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
