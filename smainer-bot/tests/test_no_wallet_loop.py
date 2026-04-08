"""Tests to lock the single-decision payment flow contract.

Ensures the "Pay & Compute" button URL is structured so the MiniApp
never presents a second wallet-choice screen after the user taps it.

Flow contract:
  1. Bot message → user taps "Pay & Compute"
  2. Braavos opens directly for approval
  3. Return automatically
  4. Compute result appears in Telegram
  NO second wallet-choice / redirect-chooser screen.

Regression: Telegram Desktop looped into a second "Pay with Braavos /
Argent" screen because:
  - flow=direct was active in standalone browser (should only fire in
    TG WebView + mobile)
  - resolveEnvironment() fell back to 'telegram-webview' in browser,
    setting requiresRedirect=true → WalletPayButtons → loop
"""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlparse, parse_qs


os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-000000:AAAAAA")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("RELAYER_API_URL", "https://api.test.smainer.io")
os.environ.setdefault("RELAYER_API_KEY", "test-relayer-key")
os.environ.setdefault("CALLBACK_SIGNING_SECRET", "test-signing-secret")
os.environ.setdefault("STARKNET_RPC_URL", "https://test-rpc.example.com")
os.environ.setdefault("CALLBACK_BASE_URL", "https://test-bot.vercel.app")


from src.handlers import handle_inference
from src.payment import PaymentManager
from src.relayer_client import RelayerClient
from src.wallet import WalletManager


_session_patch_touch = patch("src.handlers.touch_session", return_value=None)
_session_patch_check = patch("src.handlers.check_session_active", return_value=True)
_session_patch_invalidate = patch("src.handlers.invalidate_session", return_value=None)
_nonce_patch = patch("src.handlers.generate_nonce", return_value="test-nonce-lock")


def setup_module(module):
    _session_patch_touch.start()
    _session_patch_check.start()
    _session_patch_invalidate.start()
    _nonce_patch.start()


def teardown_module(module):
    _session_patch_touch.stop()
    _session_patch_check.stop()
    _session_patch_invalidate.stop()
    _nonce_patch.stop()


def _make_update(text: str, user_id: int = 12345, chat_id: int = 67890):
    return {
        "message": {
            "from": {"id": user_id},
            "chat": {"id": chat_id},
            "text": text,
        }
    }


@pytest.fixture
def mock_bot():
    bot = AsyncMock()
    msg = MagicMock()
    msg.message_id = 999
    bot.send_message.return_value = msg
    bot.edit_message_reply_markup = AsyncMock()
    bot.send_chat_action = AsyncMock()
    return bot


@pytest.fixture
def deps(mock_bot):
    wallet_mgr = AsyncMock(spec=WalletManager)
    wallet_mgr.get_linked_address.return_value = "0x" + "ab" * 32
    wallet_mgr.has_sufficient_balance.return_value = True

    payment_mgr = AsyncMock(spec=PaymentManager)

    relayer = AsyncMock(spec=RelayerClient)
    relayer.list_available_models.return_value = [
        {"node_id": "n1", "gpu": "RTX4090", "ram_gb": 64, "supported_tiers": ["small"]}
    ]
    relayer.submit_inference.return_value = "task-xyz"
    relayer.kv_get = AsyncMock(return_value=None)
    relayer.kv_set = AsyncMock()

    return {
        "bot": mock_bot,
        "wallet_mgr": wallet_mgr,
        "payment_mgr": payment_mgr,
        "relayer": relayer,
    }


class TestNoWalletChoiceLoop:
    """Payment flow must be single-decision. No second wallet-choice UI."""

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flow_url_contains_action_pay(self, mock_settings, deps):
        """URL button must include action=pay so MiniApp renders PaymentFlow."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = (
            "https://smainer-miniapp.vercel.app/?action=pay&flow=direct"
            "&prompt=test&tier=small&chat_id=67890&message_id=999&nonce=test-nonce-lock"
        )
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("test prompt")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        button = call_kwargs["reply_markup"].inline_keyboard[0][0]
        parsed = urlparse(button.url)
        qs = parse_qs(parsed.query)

        assert qs.get("action") == ["pay"], "URL must include action=pay"
        assert qs.get("flow") == ["direct"], "URL must include flow=direct"

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flow_url_has_no_redirect_loop_params(self, mock_settings, deps):
        """URL must NOT contain action=wallet-redirect — that's added by MiniApp only."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = (
            "https://smainer-miniapp.vercel.app/?action=pay&flow=direct"
            "&prompt=test&tier=small&chat_id=67890&message_id=999"
        )
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("test prompt")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        button = call_kwargs["reply_markup"].inline_keyboard[0][0]
        parsed = urlparse(button.url)
        qs = parse_qs(parsed.query)

        assert "wallet-redirect" not in qs.get("action", [""]), (
            "Bot URL must never contain action=wallet-redirect"
        )

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flow_is_url_button_not_webapp(self, mock_settings, deps):
        """Direct flow must use URL button. WebApp button opens inside TG which can't sign."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = (
            "https://smainer-miniapp.vercel.app/?action=pay&flow=direct&prompt=x&tier=small"
            "&chat_id=67890&message_id=999"
        )
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("send it")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        button = call_kwargs["reply_markup"].inline_keyboard[0][0]

        assert button.url is not None, "Must be URL button"
        assert button.web_app is None, "Must NOT be WebApp button"
        assert button.text == "💎 Pay & Compute"

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_single_button_no_wallet_choice_in_message(self, mock_settings, deps):
        """Bot message must have exactly ONE button — no wallet-choice rows."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = (
            "https://smainer-miniapp.vercel.app/?action=pay&flow=direct&prompt=x&tier=small"
            "&chat_id=67890&message_id=999"
        )
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("test")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]

        # Must be exactly 1 row with 1 button
        assert len(keyboard.inline_keyboard) == 1, "Must have exactly 1 button row"
        assert len(keyboard.inline_keyboard[0]) == 1, "Must have exactly 1 button"

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_nonce_always_present_in_direct_url(self, mock_settings, deps):
        """Payment nonce must be present for standalone browser auth."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = (
            "https://smainer-miniapp.vercel.app/?action=pay&flow=direct"
            "&prompt=x&tier=small&chat_id=67890&message_id=999&nonce=test-nonce-lock"
        )
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("test with nonce")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        # Verify get_direct_pay_url was called with nonce
        mock_settings.get_direct_pay_url.assert_called_once()
        call_kwargs = mock_settings.get_direct_pay_url.call_args
        assert call_kwargs[1].get("nonce") or (len(call_kwargs[0]) > 4 and call_kwargs[0][4]), (
            "get_direct_pay_url must be called with a nonce"
        )
