"""Tests for wallet storage migration (old plaintext → HMAC-keyed + encrypted).

Covers:
- Legacy plaintext read when HMAC key is enabled (key format migration)
- Legacy plaintext value when encryption key is enabled (value migration)
- Both migrations simultaneously
- No data loss on migration write failure
- Unlink cleans up both old and new keys
- No addresses/secrets appear in log output
"""

import hashlib
import hmac
import logging
import os

import pytest
from unittest.mock import AsyncMock, patch

# Ensure env vars are set before src imports
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-000000:AAAAAA")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("RELAYER_API_URL", "https://api.test.smainer.io")
os.environ.setdefault("RELAYER_API_KEY", "test-relayer-key")
os.environ.setdefault("CALLBACK_SIGNING_SECRET", "test-signing-secret")
os.environ.setdefault("STARKNET_RPC_URL", "https://test-rpc.example.com")
os.environ.setdefault("CALLBACK_BASE_URL", "https://test-bot.vercel.app")

from cryptography.fernet import Fernet

from src.wallet import WalletManager
from src.wallet_crypto import (
    _PLAIN_ADDRESS_RE,
    decrypt_address,
    derive_wallet_key,
    encrypt_address,
    is_hmac_key_active,
    plain_wallet_key,
)

TEST_ADDRESS = "0x" + "04a3ff".zfill(64)
TEST_USER_ID = 12345
TEST_HMAC_KEY = "test-hmac-secret-key-for-wallet-migration"
TEST_FERNET_KEY = Fernet.generate_key().decode("utf-8")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _derive_hmac_key(user_id: int, hmac_key: str) -> str:
    digest = hmac.new(
        hmac_key.encode("utf-8"),
        str(user_id).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"wallet_h:{digest}"


def _make_kv(store: dict | None = None) -> AsyncMock:
    """Build a mock KV client backed by a real dict for realistic get/set/delete."""
    _store = store if store is not None else {}
    kv = AsyncMock()

    async def _get(key):
        return _store.get(key)

    async def _set(key, value, ttl=None):
        _store[key] = value

    async def _delete(key):
        _store.pop(key, None)

    kv.kv_get = AsyncMock(side_effect=_get)
    kv.kv_set = AsyncMock(side_effect=_set)
    kv.kv_delete = AsyncMock(side_effect=_delete)
    kv._store = _store  # expose for assertions
    return kv


# ---------------------------------------------------------------------------
# wallet_crypto unit tests for migration helpers
# ---------------------------------------------------------------------------


class TestPlainWalletKey:
    def test_always_returns_plain_format(self):
        assert plain_wallet_key(12345) == "wallet:12345"
        assert plain_wallet_key(0) == "wallet:0"


class TestIsHmacKeyActive:
    def test_inactive_when_not_set(self):
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_hmac_key = ""
            assert is_hmac_key_active() is False

    def test_active_when_set(self):
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_hmac_key = TEST_HMAC_KEY
            assert is_hmac_key_active() is True


class TestDecryptAddressLegacyFallback:
    """decrypt_address should recognise legacy plaintext hex when Fernet is active."""

    def test_plaintext_hex_returned_when_fernet_active(self):
        import src.wallet_crypto as wc

        # Reset the cached fernet
        wc._fernet = None
        with patch.object(wc.settings, "wallet_encryption_key", TEST_FERNET_KEY):
            wc._fernet = None  # force re-init
            result = decrypt_address(TEST_ADDRESS)
        # Reset
        wc._fernet = None
        assert result == TEST_ADDRESS

    def test_corrupted_non_hex_returns_none(self):
        import src.wallet_crypto as wc

        wc._fernet = None
        with patch.object(wc.settings, "wallet_encryption_key", TEST_FERNET_KEY):
            wc._fernet = None
            result = decrypt_address("not-valid-data-ZZZ")
        wc._fernet = None
        assert result is None

    def test_encrypted_value_decrypts_normally(self):
        import src.wallet_crypto as wc

        wc._fernet = None
        with patch.object(wc.settings, "wallet_encryption_key", TEST_FERNET_KEY):
            wc._fernet = None
            enc = encrypt_address(TEST_ADDRESS)
            result = decrypt_address(enc)
        wc._fernet = None
        assert result == TEST_ADDRESS


class TestPlainAddressRegex:
    def test_matches_valid_addresses(self):
        assert _PLAIN_ADDRESS_RE.match("0x04a3ff")
        assert _PLAIN_ADDRESS_RE.match("0x" + "ab" * 32)

    def test_rejects_non_addresses(self):
        assert not _PLAIN_ADDRESS_RE.match("gAAAAABk...")  # Fernet token
        assert not _PLAIN_ADDRESS_RE.match("random-string")
        assert not _PLAIN_ADDRESS_RE.match("")


# ---------------------------------------------------------------------------
# WalletManager migration integration tests
# ---------------------------------------------------------------------------


class TestGetLinkedAddressMigration:
    """get_linked_address falls back to legacy key and migrates forward."""

    @pytest.mark.asyncio
    async def test_reads_new_key_when_present(self):
        """When the new HMAC key has data, legacy is never consulted."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            new_key = derive_wallet_key(TEST_USER_ID)
            store = {new_key: TEST_ADDRESS}
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            result = await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        assert result == TEST_ADDRESS
        # Legacy key should not have been queried beyond the new key
        # (kv_get called once for the new key which returned data)
        assert kv.kv_get.call_count == 1

    @pytest.mark.asyncio
    async def test_migrates_from_plain_key_to_hmac_key(self):
        """Legacy wallet:{id} → wallet_h:{digest} migration."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            legacy_key = f"wallet:{TEST_USER_ID}"
            new_key = derive_wallet_key(TEST_USER_ID)
            assert new_key != legacy_key  # sanity check

            store = {legacy_key: TEST_ADDRESS}
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            result = await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        assert result == TEST_ADDRESS
        # After migration: new key present, legacy key removed
        assert new_key in kv._store
        assert legacy_key not in kv._store

    @pytest.mark.asyncio
    async def test_migrates_plaintext_value_to_encrypted(self):
        """Plaintext address value → Fernet-encrypted migration."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", TEST_FERNET_KEY),
        ):
            wc._fernet = None
            legacy_key = f"wallet:{TEST_USER_ID}"
            new_key = derive_wallet_key(TEST_USER_ID)

            store = {legacy_key: TEST_ADDRESS}  # old plaintext
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            result = await mgr.get_linked_address(TEST_USER_ID)

            assert result == TEST_ADDRESS
            # New key should hold encrypted value
            new_stored = kv._store.get(new_key)
            assert new_stored is not None
            assert new_stored != TEST_ADDRESS  # must be encrypted
            # Verify it round-trips
            assert decrypt_address(new_stored) == TEST_ADDRESS
            # Legacy key cleaned up
            assert legacy_key not in kv._store

        wc._fernet = None

    @pytest.mark.asyncio
    async def test_no_data_loss_on_migration_write_failure(self):
        """If migration kv_set fails, address is still returned."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            legacy_key = f"wallet:{TEST_USER_ID}"
            store = {legacy_key: TEST_ADDRESS}
            kv = _make_kv(store)
            # Make migration write fail
            kv.kv_set = AsyncMock(side_effect=Exception("KV write error"))
            mgr = WalletManager(kv)

            result = await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        assert result == TEST_ADDRESS  # address still returned

    @pytest.mark.asyncio
    async def test_returns_none_when_not_linked_anywhere(self):
        """No data under either key → None."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            kv = _make_kv({})
            mgr = WalletManager(kv)
            result = await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        assert result is None

    @pytest.mark.asyncio
    async def test_no_migration_when_hmac_not_active(self):
        """When HMAC key is empty, key format is unchanged → no fallback needed."""
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", ""),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            # Derive produces the legacy format
            kv_key = derive_wallet_key(TEST_USER_ID)
            assert kv_key == f"wallet:{TEST_USER_ID}"

            store = {kv_key: TEST_ADDRESS}
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            result = await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        assert result == TEST_ADDRESS
        # Only one get call — no fallback attempt
        assert kv.kv_get.call_count == 1


# ---------------------------------------------------------------------------
# Unlink cleans up both keys
# ---------------------------------------------------------------------------


class TestUnlinkWalletMigration:
    @pytest.mark.asyncio
    async def test_unlink_deletes_both_keys_when_hmac_active(self):
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            new_key = derive_wallet_key(TEST_USER_ID)
            legacy_key = f"wallet:{TEST_USER_ID}"
            store = {new_key: TEST_ADDRESS, legacy_key: TEST_ADDRESS}
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            await mgr.unlink_wallet(TEST_USER_ID)

        wc._fernet = None
        assert new_key not in kv._store
        assert legacy_key not in kv._store

    @pytest.mark.asyncio
    async def test_unlink_single_delete_when_hmac_not_active(self):
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", ""),
            patch.object(wc.settings, "wallet_encryption_key", ""),
        ):
            wc._fernet = None
            kv = _make_kv({})
            mgr = WalletManager(kv)
            await mgr.unlink_wallet(TEST_USER_ID)

        wc._fernet = None
        # Only one delete (legacy == current key format)
        assert kv.kv_delete.call_count == 1


# ---------------------------------------------------------------------------
# No secrets in logs
# ---------------------------------------------------------------------------


class TestNoSecretsInLogs:
    """Ensure wallet addresses and crypto keys never appear in log records."""

    @pytest.mark.asyncio
    async def test_migration_logs_contain_no_addresses(self, caplog):
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_hmac_key", TEST_HMAC_KEY),
            patch.object(wc.settings, "wallet_encryption_key", ""),
            caplog.at_level(logging.DEBUG),
        ):
            wc._fernet = None
            legacy_key = f"wallet:{TEST_USER_ID}"
            store = {legacy_key: TEST_ADDRESS}
            kv = _make_kv(store)
            mgr = WalletManager(kv)

            await mgr.get_linked_address(TEST_USER_ID)

        wc._fernet = None
        full_log = caplog.text
        assert TEST_ADDRESS not in full_log
        assert "04a3ff" not in full_log.lower()
        # Ensure HMAC key itself isn't logged either
        assert TEST_HMAC_KEY not in full_log

    @pytest.mark.asyncio
    async def test_decrypt_failure_logs_no_value(self, caplog):
        import src.wallet_crypto as wc

        wc._fernet = None
        with (
            patch.object(wc.settings, "wallet_encryption_key", TEST_FERNET_KEY),
            caplog.at_level(logging.DEBUG),
        ):
            wc._fernet = None
            # Non-hex, non-Fernet garbage
            result = decrypt_address("corrupted-garbage-data")

        wc._fernet = None
        assert result is None
        assert "corrupted-garbage-data" not in caplog.text
