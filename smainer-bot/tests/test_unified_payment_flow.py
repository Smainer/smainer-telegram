"""Tests for unified payment flow — TM-041-01 acceptance criteria."""

import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import settings
from src.handlers import handle_inference, infer_tier
from src.models import ModelTier
from src.nonce import NONCE_TTL_SECONDS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_update(text: str, user_id: int = 12345, chat_id: int = 67890):
    return {
        "message": {
            "from": {"id": user_id},
            "chat": {"id": chat_id},
            "text": text,
        }
    }


def _make_init_data(user_id: int = 12345, age_seconds: int = 10) -> str:
    """Build a fake Telegram initData string with valid auth_date."""
    auth_date = str(int(time.time()) - age_seconds)
    user_json = json.dumps({"id": user_id})
    # Build data pairs
    data_pairs = [f"auth_date={auth_date}", f"user={user_json}"]
    data_pairs.sort()
    data_check_string = "\n".join(data_pairs)
    secret_key = hmac.new(
        b"WebAppData",
        settings.telegram_bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    hash_value = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"auth_date={auth_date}&user={user_json}&hash={hash_value}"


# ---------------------------------------------------------------------------
# Test: Inference handler no longer shows Connect Wallet button
# ---------------------------------------------------------------------------


class TestUnifiedPaymentFlow:
    """AC: Single PaymentFlow component handles both new connections and
    existing wallet approvals. The 'Connect Wallet' button must not appear."""

    @pytest.mark.asyncio
    async def test_inference_single_button_no_connect_wallet(self):
        """Verify that handle_inference shows only 'Pay & Compute', never
        'Connect Wallet'."""
        mock_bot = AsyncMock()
        mock_bot.send_message = AsyncMock(return_value=MagicMock(message_id=999))
        mock_bot.edit_message_reply_markup = AsyncMock()
        mock_bot.send_chat_action = AsyncMock()

        wallet_mgr = AsyncMock()
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)  # No wallet linked

        payment_mgr = AsyncMock()

        relayer = AsyncMock()
        relayer.list_available_models = AsyncMock(
            return_value=[
                {"node_id": "node123", "gpu": "RTX 4000", "ram_gb": 16, "supported_tiers": ["small"]}
            ]
        )
        relayer.kv_get = AsyncMock(return_value=None)

        update = _make_update("Hello AI, answer my question")

        with patch("src.handlers.generate_nonce", return_value="test-nonce-abc"):
            await handle_inference(update, mock_bot, wallet_mgr, payment_mgr, relayer)

        # Verify edit_message_reply_markup was called
        assert mock_bot.edit_message_reply_markup.called

        # Get the keyboard from the call
        call_kwargs = mock_bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]

        # Should have exactly 1 row (Pay & Compute only)
        rows = keyboard.inline_keyboard
        assert len(rows) == 1, f"Expected 1 button row, got {len(rows)}: {rows}"

        # The first (and only) button should be Pay & Compute
        btn = rows[0][0]
        assert "Pay" in btn.text and "Compute" in btn.text

    @pytest.mark.asyncio
    async def test_inference_pay_url_includes_nonce(self):
        """Verify that the Pay & Compute URL includes a bot-issued nonce."""
        mock_bot = AsyncMock()
        mock_bot.send_message = AsyncMock(return_value=MagicMock(message_id=999))
        mock_bot.edit_message_reply_markup = AsyncMock()
        mock_bot.send_chat_action = AsyncMock()

        wallet_mgr = AsyncMock()
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)

        payment_mgr = AsyncMock()

        relayer = AsyncMock()
        relayer.list_available_models = AsyncMock(
            return_value=[
                {"node_id": "node123", "gpu": "RTX 4000", "ram_gb": 16, "supported_tiers": ["small"]}
            ]
        )
        relayer.kv_get = AsyncMock(return_value=None)

        update = _make_update("Test prompt")

        with patch("src.handlers.generate_nonce", return_value="nonce-xyz-123"):
            await handle_inference(update, mock_bot, wallet_mgr, payment_mgr, relayer)

        call_kwargs = mock_bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        btn = keyboard.inline_keyboard[0][0]
        # WebAppInfo URL should contain the nonce
        assert "nonce=nonce-xyz-123" in btn.web_app.url


# ---------------------------------------------------------------------------
# Test: initData max-age enforcement
# ---------------------------------------------------------------------------


class TestInitDataMaxAge:
    """AC: All callback timestamps must be within 300 seconds."""

    def test_expired_init_data_rejected(self):
        """initData older than 300s should be rejected by wallet-check."""
        from api.wallet_check import verify_telegram_init_data

        expired_data = _make_init_data(age_seconds=400)
        result = verify_telegram_init_data(expired_data, settings.telegram_bot_token)
        assert result is None, "Expired initData should be rejected"

    def test_fresh_init_data_accepted(self):
        """initData within 300s should be accepted."""
        from api.wallet_check import verify_telegram_init_data

        fresh_data = _make_init_data(age_seconds=10)
        result = verify_telegram_init_data(fresh_data, settings.telegram_bot_token)
        assert result is not None, "Fresh initData should be accepted"


# ---------------------------------------------------------------------------
# Test: Nonce generation and verification
# ---------------------------------------------------------------------------


class TestNonceFlow:
    """AC: Standalone browser completion path must use a bot-issued nonce."""

    @patch("src.nonce.httpx")
    def test_generate_nonce_returns_string(self, mock_httpx):
        """Nonce generation should return a non-empty string."""
        from src.nonce import generate_nonce

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_httpx.put.return_value = mock_response

        nonce = generate_nonce(user_id=12345, chat_id=67890)
        assert isinstance(nonce, str)
        assert len(nonce) > 20  # token_urlsafe(32) produces ~43 chars

    @patch("src.nonce.httpx")
    def test_verify_and_consume_nonce_valid(self, mock_httpx):
        """Valid nonce should be verified and consumed."""
        from src.nonce import verify_and_consume_nonce

        ts = str(int(time.time()))
        nonce_value = f"12345:67890:{ts}"

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200
        mock_get_resp.json.return_value = {"value": nonce_value}

        mock_delete_resp = MagicMock()
        mock_delete_resp.status_code = 200

        mock_httpx.get.return_value = mock_get_resp
        mock_httpx.delete.return_value = mock_delete_resp

        is_valid, user_id = verify_and_consume_nonce("test-nonce", expected_chat_id="67890")
        assert is_valid is True
        assert user_id == "12345"

        # Verify the nonce was consumed (deleted)
        mock_httpx.delete.assert_called_once()

    @patch("src.nonce.httpx")
    def test_verify_nonce_expired(self, mock_httpx):
        """Expired nonce should be rejected."""
        from src.nonce import verify_and_consume_nonce

        old_ts = str(int(time.time()) - NONCE_TTL_SECONDS - 100)
        nonce_value = f"12345:67890:{old_ts}"

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200
        mock_get_resp.json.return_value = {"value": nonce_value}

        mock_httpx.get.return_value = mock_get_resp

        is_valid, user_id = verify_and_consume_nonce("expired-nonce")
        assert is_valid is False

    @patch("src.nonce.httpx")
    def test_verify_nonce_not_found(self, mock_httpx):
        """Non-existent nonce should be rejected."""
        from src.nonce import verify_and_consume_nonce

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 404

        mock_httpx.get.return_value = mock_get_resp

        is_valid, user_id = verify_and_consume_nonce("unknown-nonce")
        assert is_valid is False

    @patch("src.nonce.httpx")
    def test_verify_nonce_wrong_chat_id(self, mock_httpx):
        """Nonce with wrong chat_id should be rejected."""
        from src.nonce import verify_and_consume_nonce

        ts = str(int(time.time()))
        nonce_value = f"12345:67890:{ts}"

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200
        mock_get_resp.json.return_value = {"value": nonce_value}

        mock_httpx.get.return_value = mock_get_resp

        is_valid, user_id = verify_and_consume_nonce("test-nonce", expected_chat_id="99999")
        assert is_valid is False


# ---------------------------------------------------------------------------
# Test: Rate limiting
# ---------------------------------------------------------------------------


class TestRateLimiting:
    """AC: Rate limiting must be implemented on all payment endpoints."""

    @patch("src.rate_limit.httpx")
    def test_rate_limit_allows_within_threshold(self, mock_httpx):
        """Requests within the limit should be allowed."""
        from src.rate_limit import check_rate_limit

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200
        mock_get_resp.json.return_value = {"value": "5"}

        mock_put_resp = MagicMock()
        mock_put_resp.status_code = 200

        mock_httpx.get.return_value = mock_get_resp
        mock_httpx.put.return_value = mock_put_resp

        result = check_rate_limit("test-endpoint", "user123", max_requests=20)
        assert result is True

    @patch("src.rate_limit.httpx")
    def test_rate_limit_blocks_over_threshold(self, mock_httpx):
        """Requests over the limit should be blocked."""
        from src.rate_limit import check_rate_limit

        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200
        mock_get_resp.json.return_value = {"value": "20"}

        mock_httpx.get.return_value = mock_get_resp

        result = check_rate_limit("test-endpoint", "user123", max_requests=20)
        assert result is False


# ---------------------------------------------------------------------------
# Test: Config connect URL no longer points to /connect
# ---------------------------------------------------------------------------


class TestConfigUrls:
    """AC: No circular redirects — connect URL must not point to dead route."""

    def test_connect_url_is_base_url(self):
        """get_miniapp_connect_url() should return base URL, not /connect."""
        url = settings.get_miniapp_connect_url()
        assert not url.endswith("/connect"), f"Connect URL should not end with /connect: {url}"

    def test_pay_url_includes_nonce(self):
        """get_miniapp_pay_url() should include nonce when provided."""
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="test-nonce",
        )
        assert "nonce=test-nonce" in url

    def test_pay_url_omits_nonce_when_empty(self):
        """get_miniapp_pay_url() should not include nonce param when empty."""
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=123,
            message_id=456,
        )
        assert "nonce=" not in url
