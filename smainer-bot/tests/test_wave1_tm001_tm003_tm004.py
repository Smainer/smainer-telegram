"""Tests for Wave 1 TM-001 + TM-003 + TM-004 implementation.

Covers:
- TM-001: Encrypted persistent wallet state (HMAC keys, Fernet encryption)
- TM-003: Anti-loop guardrails (action allowlist, two-phase nonce expiry)
- TM-004: 15-minute idle session timeout
- Constraint 5: Sensitive telemetry opt-in
- Constraint 6: Constant-time comparison
"""

import hmac
import os
import time

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure test env vars are set before importing src modules
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-000000:AAAAAA")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("RELAYER_API_URL", "https://api.test.smainer.io")
os.environ.setdefault("RELAYER_API_KEY", "test-relayer-key")
os.environ.setdefault("CALLBACK_SIGNING_SECRET", "test-signing-secret")
os.environ.setdefault("STARKNET_RPC_URL", "https://test-rpc.example.com")
os.environ.setdefault("CALLBACK_BASE_URL", "https://test-bot.vercel.app")


# ═══════════════════════════════════════════════════════════════════
# TM-001: Encrypted Persistent Wallet State
# ═══════════════════════════════════════════════════════════════════


class TestWalletCrypto:
    """Test HMAC key derivation and Fernet encryption for wallet addresses."""

    def test_derive_wallet_key_without_hmac(self):
        """Without WALLET_HMAC_KEY, falls back to plain key."""
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_hmac_key = ""
            from src.wallet_crypto import derive_wallet_key

            key = derive_wallet_key(12345)
            assert key == "wallet:12345"

    def test_derive_wallet_key_with_hmac(self):
        """With WALLET_HMAC_KEY, produces HMAC-SHA256 hex digest key."""
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_hmac_key = "test-hmac-secret-key"
            from src.wallet_crypto import derive_wallet_key

            key = derive_wallet_key(12345)
            assert key.startswith("wallet_h:")
            assert len(key) > 20  # HMAC digest is 64 hex chars
            # Same input → same output (deterministic)
            assert derive_wallet_key(12345) == key
            # Different input → different output
            assert derive_wallet_key(99999) != key

    def test_encrypt_decrypt_roundtrip(self):
        """Fernet encrypt/decrypt preserves the original address."""
        from cryptography.fernet import Fernet

        test_key = Fernet.generate_key().decode("utf-8")

        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_encryption_key = test_key
            # Reset cached Fernet instance
            import src.wallet_crypto as wc
            wc._fernet = None

            address = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
            encrypted = wc.encrypt_address(address)
            assert encrypted != address  # Must be different
            decrypted = wc.decrypt_address(encrypted)
            assert decrypted == address

    def test_encrypt_noop_without_key(self):
        """Without WALLET_ENCRYPTION_KEY, address passes through unchanged."""
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_encryption_key = ""
            import src.wallet_crypto as wc
            wc._fernet = None

            address = "0x1234abcd"
            assert wc.encrypt_address(address) == address
            assert wc.decrypt_address(address) == address

    def test_decrypt_wrong_key_returns_none(self):
        """Decryption with wrong key returns None (not an exception)."""
        from cryptography.fernet import Fernet

        key1 = Fernet.generate_key().decode("utf-8")
        key2 = Fernet.generate_key().decode("utf-8")

        import src.wallet_crypto as wc

        # Encrypt with key1
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_encryption_key = key1
            wc._fernet = None
            encrypted = wc.encrypt_address("0xdeadbeef")

        # Decrypt with key2
        with patch("src.wallet_crypto.settings") as mock_settings:
            mock_settings.wallet_encryption_key = key2
            wc._fernet = None
            result = wc.decrypt_address(encrypted)
            assert result is None


class TestWalletManagerEncrypted:
    """Test WalletManager uses HMAC keys and encryption."""

    @pytest.mark.asyncio
    async def test_link_wallet_uses_hmac_key(self):
        """link_wallet stores under HMAC-derived key."""
        from src.wallet import WalletManager

        kv = AsyncMock()
        kv.kv_set = AsyncMock()

        with patch("src.wallet.settings") as mock_settings, \
             patch("src.wallet.derive_wallet_key", return_value="wallet_h:abc123") as mock_derive, \
             patch("src.wallet.encrypt_address", side_effect=lambda x: f"ENC:{x}") as mock_enc:
            mock_settings.telemetry_sensitive_fields = False

            mgr = WalletManager(kv)
            await mgr.link_wallet(42, "0x1234")

            mock_derive.assert_called_once_with(42)
            kv.kv_set.assert_called_once_with("wallet_h:abc123", "ENC:0x0000000000000000000000000000000000000000000000000000000000001234")

    @pytest.mark.asyncio
    async def test_get_linked_address_decrypts(self):
        """get_linked_address decrypts stored value."""
        from src.wallet import WalletManager

        kv = AsyncMock()
        kv.kv_get = AsyncMock(return_value="ENCRYPTED_DATA")

        with patch("src.wallet.derive_wallet_key", return_value="wallet_h:abc"), \
             patch("src.wallet.decrypt_address", return_value="0xdecrypted"):
            mgr = WalletManager(kv)
            result = await mgr.get_linked_address(42)
            assert result == "0xdecrypted"


# ═══════════════════════════════════════════════════════════════════
# TM-003: Anti-Loop Guardrails
# ═══════════════════════════════════════════════════════════════════


class TestWebappActionAllowlist:
    """Test strict allowlist validation for webapp_data actions."""

    def test_allowed_actions_are_defined(self):
        from src.handlers import ALLOWED_WEBAPP_ACTIONS

        assert "wallet_connect" in ALLOWED_WEBAPP_ACTIONS
        assert "payment_complete" in ALLOWED_WEBAPP_ACTIONS
        assert "wallet_disconnect" in ALLOWED_WEBAPP_ACTIONS

    def test_unknown_action_not_in_allowlist(self):
        from src.handlers import ALLOWED_WEBAPP_ACTIONS

        assert "admin_override" not in ALLOWED_WEBAPP_ACTIONS
        assert "exec" not in ALLOWED_WEBAPP_ACTIONS
        assert "" not in ALLOWED_WEBAPP_ACTIONS
        assert None not in ALLOWED_WEBAPP_ACTIONS

    @pytest.mark.asyncio
    async def test_blocked_action_sends_error(self):
        """Unknown action should be blocked and error message sent."""
        from src.handlers import handle_webapp_data
        from src.wallet import WalletManager
        from src.payment import PaymentManager
        from src.relayer_client import RelayerClient

        bot = AsyncMock()
        msg = MagicMock()
        msg.message_id = 1
        bot.send_message.return_value = msg

        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        update = {
            "message": {
                "from": {"id": 123},
                "chat": {"id": 456},
                "web_app_data": {"data": '{"action": "evil_action"}'},
            }
        }

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        bot.send_message.assert_called_once()
        call_kwargs = bot.send_message.call_args
        assert "Unrecognized action" in str(call_kwargs)


class TestTwoPhaseNonce:
    """Test two-phase nonce expiry (Constraint 3)."""

    def test_nonce_format_has_four_parts(self):
        """Generated nonce value has user_id:chat_id:created_ts:activated_ts format."""
        with patch("src.nonce.httpx") as mock_httpx, \
             patch("src.nonce.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"

            from src.nonce import generate_nonce

            nonce = generate_nonce(12345, 67890)
            assert len(nonce) > 20  # URL-safe token

            # Verify the KV value format
            put_call = mock_httpx.put.call_args
            if put_call:
                body = put_call.kwargs.get("json", {}) if put_call.kwargs else {}
                value = body.get("value", "")
                parts = value.split(":")
                assert len(parts) == 4, f"Expected 4 parts, got {len(parts)}: {value}"
                assert parts[0] == "12345"  # user_id
                assert parts[1] == "67890"  # chat_id
                assert parts[3] == "0"  # not yet activated

    def test_nonce_untouched_ttl(self):
        """Generated nonce uses 5-minute untouched TTL."""
        with patch("src.nonce.httpx") as mock_httpx, \
             patch("src.nonce.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"

            from src.nonce import generate_nonce, NONCE_UNTOUCHED_TTL_SECONDS

            generate_nonce(1, 2)
            put_call = mock_httpx.put.call_args
            if put_call:
                body = put_call.kwargs.get("json", {}) if put_call.kwargs else {}
                assert body.get("ttl_seconds") == NONCE_UNTOUCHED_TTL_SECONDS
                assert NONCE_UNTOUCHED_TTL_SECONDS == 300

    def test_nonce_constants(self):
        """Verify nonce timing constants match spec."""
        from src.nonce import (
            NONCE_UNTOUCHED_TTL_SECONDS,
            NONCE_ACTIVE_TTL_SECONDS,
            NONCE_MAX_AGE_SECONDS,
        )

        assert NONCE_UNTOUCHED_TTL_SECONDS == 300  # 5 minutes
        assert NONCE_ACTIVE_TTL_SECONDS == 300  # 5 minutes
        assert NONCE_MAX_AGE_SECONDS == 600  # total cap


# ═══════════════════════════════════════════════════════════════════
# TM-004: 15-Minute Idle Session Timeout
# ═══════════════════════════════════════════════════════════════════


class TestSessionTimeout:
    """Test session idle timeout logic."""

    def test_session_timeout_constant(self):
        from src.session import SESSION_IDLE_TIMEOUT_SECONDS

        assert SESSION_IDLE_TIMEOUT_SECONDS == 900  # 15 minutes

    def test_session_key_plain(self):
        """Without HMAC key, uses plain session key."""
        with patch("src.session.settings") as mock_settings:
            mock_settings.wallet_hmac_key = ""
            from src.session import _session_key

            assert _session_key(123) == "sess:123"

    def test_session_key_hmac(self):
        """With HMAC key, uses hashed session key."""
        with patch("src.session.settings") as mock_settings:
            mock_settings.wallet_hmac_key = "test-hmac-key"
            from src.session import _session_key

            key = _session_key(123)
            assert key.startswith("sess:")
            assert key != "sess:123"
            assert len(key) > 10

    def test_check_session_expired(self):
        """Session older than 15 minutes returns False."""
        with patch("src.session.httpx") as mock_httpx, \
             patch("src.session.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"
            mock_settings.wallet_hmac_key = ""

            # Simulate a session that was touched 20 minutes ago
            old_ts = str(int(time.time()) - 1200)
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"value": old_ts}
            mock_resp.raise_for_status = MagicMock()
            mock_httpx.get.return_value = mock_resp

            from src.session import check_session_active

            assert check_session_active(123) is False

    def test_check_session_active(self):
        """Session touched recently returns True."""
        with patch("src.session.httpx") as mock_httpx, \
             patch("src.session.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"
            mock_settings.wallet_hmac_key = ""

            recent_ts = str(int(time.time()) - 60)  # 1 minute ago
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"value": recent_ts}
            mock_resp.raise_for_status = MagicMock()
            mock_httpx.get.return_value = mock_resp

            from src.session import check_session_active

            assert check_session_active(123) is True

    def test_check_session_no_session(self):
        """No session (404) returns False."""
        with patch("src.session.httpx") as mock_httpx, \
             patch("src.session.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"
            mock_settings.wallet_hmac_key = ""

            mock_resp = MagicMock()
            mock_resp.status_code = 404
            mock_httpx.get.return_value = mock_resp

            from src.session import check_session_active

            assert check_session_active(123) is False

    def test_check_session_fail_open(self):
        """KV failure returns True (fail-open for availability)."""
        with patch("src.session.httpx") as mock_httpx, \
             patch("src.session.settings") as mock_settings:
            mock_settings.relayer_api_url = "https://api.test.smainer.io"
            mock_settings.relayer_api_key = "test-key"
            mock_settings.wallet_hmac_key = ""

            mock_httpx.get.side_effect = Exception("KV unavailable")

            from src.session import check_session_active

            assert check_session_active(123) is True


# ═══════════════════════════════════════════════════════════════════
# Constraint 5: Sensitive Telemetry Opt-In
# ═══════════════════════════════════════════════════════════════════


class TestTelemetryOptIn:
    """Test that sensitive fields are only logged when opted in."""

    def test_telemetry_default_off(self):
        from src.config import Settings

        s = Settings(telegram_bot_token="test:token")
        assert s.telemetry_sensitive_fields is False


# ═══════════════════════════════════════════════════════════════════
# Constraint 6: Constant-Time Comparison
# ═══════════════════════════════════════════════════════════════════


class TestConstantTimeComparison:
    """Verify constant-time comparison is used for auth tokens."""

    def test_webhook_uses_compare_digest(self):
        """Webhook secret verification uses hmac.compare_digest."""
        import inspect
        from api.webhook import _verify_webhook_secret

        source = inspect.getsource(_verify_webhook_secret)
        assert "compare_digest" in source

    def test_callback_auth_uses_compare_digest(self):
        """Callback auth uses hmac.compare_digest."""
        import inspect
        from src.callback_auth import verify_callback_signature

        source = inspect.getsource(verify_callback_signature)
        assert "compare_digest" in source
