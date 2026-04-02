"""Tests for Wave 0 Option D — Direct wallet flow.

Validates:
- Feature flag controls flow selection (MTG-301 constraint #3)
- Direct flow uses URL button (not WebApp)
- Legacy flow uses WebApp button
- PaymentVerifier.verify_escrow() called before task scheduling (constraint #5)
- Wallet flow type logged for audit trail (constraint #7)
- Feature flag rollback preserves legacy flow (constraint #6)
- Address normalization consistent (constraint #7)
"""

import os
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# Must be set before importing src modules
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-000000:AAAAAA")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("RELAYER_API_URL", "https://api.test.smainer.io")
os.environ.setdefault("RELAYER_API_KEY", "test-relayer-key")
os.environ.setdefault("CALLBACK_SIGNING_SECRET", "test-signing-secret")
os.environ.setdefault("STARKNET_RPC_URL", "https://test-rpc.example.com")
os.environ.setdefault("CALLBACK_BASE_URL", "https://test-bot.vercel.app")


from src.handlers import handle_inference, handle_webapp_data
from src.models import ModelTier
from src.payment import PaymentManager
from src.payment_verifier import PaymentVerifier, normalize_address
from src.relayer_client import RelayerClient
from src.wallet import WalletManager


# Patch session operations globally to avoid hanging HTTP calls during tests
_session_patch_touch = patch("src.handlers.touch_session", return_value=None)
_session_patch_check = patch("src.handlers.check_session_active", return_value=True)
_session_patch_invalidate = patch("src.handlers.invalidate_session", return_value=None)
_nonce_patch = patch("src.handlers.generate_nonce", return_value="test-nonce-auto")


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


def _make_webapp_update(data: dict, user_id: int = 12345, chat_id: int = 67890):
    return {
        "message": {
            "from": {"id": user_id},
            "chat": {"id": chat_id},
            "text": "",
            "web_app_data": {"data": json.dumps(data)},
        }
    }


@pytest.fixture
def mock_bot():
    bot = AsyncMock()
    msg = MagicMock()
    msg.message_id = 999
    bot.send_message.return_value = msg
    bot.edit_message_reply_markup = AsyncMock()
    bot.edit_message_text = AsyncMock()
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


# ---------------------------------------------------------------------------
# Feature flag: flow selection (constraint #3)
# ---------------------------------------------------------------------------


class TestDirectFlowFeatureFlag:
    """Feature flag must be scoped to flow selection only."""

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flow_uses_url_button(self, mock_settings, deps):
        """When wallet_flow_direct=True, bot uses URL button (not WebApp)."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = "https://smainer-miniapp.vercel.app/?action=pay&flow=direct&prompt=hi"
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("Hello AI")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        # Verify edit_message_reply_markup was called
        deps["bot"].edit_message_reply_markup.assert_called_once()
        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]

        # Extract the button — should be a URL button, NOT a WebApp button
        button = keyboard.inline_keyboard[0][0]
        assert button.url is not None, "Direct flow should use URL button"
        assert button.web_app is None, "Direct flow should NOT use WebApp button"
        assert "flow=direct" in button.url
        assert button.text == "💎 Pay & Compute"

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_legacy_flow_uses_webapp_button(self, mock_settings, deps):
        """When wallet_flow_direct=False, bot uses WebApp button (legacy)."""
        mock_settings.wallet_flow_direct = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_miniapp_pay_url.return_value = "https://smainer-miniapp.vercel.app/?action=pay&prompt=hi"
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("Hello AI")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["bot"].edit_message_reply_markup.assert_called_once()
        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]

        button = keyboard.inline_keyboard[0][0]
        assert button.web_app is not None, "Legacy flow should use WebApp button"
        assert button.url is None, "Legacy flow should NOT use URL button"

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_feature_flag_rollback(self, mock_settings, deps):
        """Constraint #6: Toggling flag back to False restores legacy flow."""
        # Start with direct
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = "https://smainer-miniapp.vercel.app/?flow=direct"
        mock_settings.get_miniapp_pay_url.return_value = "https://smainer-miniapp.vercel.app/?action=pay"
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("Test prompt")
        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        button1 = deps["bot"].edit_message_reply_markup.call_args[1]["reply_markup"].inline_keyboard[0][0]
        assert button1.url is not None, "Direct flow active"

        # Reset mocks and toggle to legacy
        deps["bot"].reset_mock()
        mock_settings.wallet_flow_direct = False
        msg = MagicMock()
        msg.message_id = 1000
        deps["bot"].send_message.return_value = msg

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        button2 = deps["bot"].edit_message_reply_markup.call_args[1]["reply_markup"].inline_keyboard[0][0]
        assert button2.web_app is not None, "Legacy flow restored after flag rollback"


# ---------------------------------------------------------------------------
# PaymentVerifier (constraint #5)
# ---------------------------------------------------------------------------


class TestPaymentVerifier:
    """Payment verification must execute before task scheduling."""

    @pytest.mark.asyncio
    async def test_verify_escrow_skips_without_contract(self):
        """When contract address is empty, verification passes gracefully."""
        with patch("src.payment_verifier.settings") as mock_settings:
            mock_settings.smainer_contract_address = ""
            verifier = PaymentVerifier()
            ok, err = await verifier.verify_escrow(1, "0x04a3")
            assert ok is True
            assert err is None

    @pytest.mark.asyncio
    async def test_verify_escrow_handles_import_error(self):
        """When starknet-py is not available, verification passes gracefully."""
        with patch("src.payment_verifier.settings") as mock_settings:
            mock_settings.smainer_contract_address = "0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe"
            mock_settings.starknet_rpc_url = "https://test-rpc.example.com"
            verifier = PaymentVerifier()

            # Force ImportError by patching the import
            with patch.dict("sys.modules", {"starknet_py": None, "starknet_py.net.full_node_client": None}):
                ok, err = await verifier.verify_escrow(1, "0x04a3")
                assert ok is True


# ---------------------------------------------------------------------------
# Address normalization consistency (constraint #7)
# ---------------------------------------------------------------------------


class TestAddressNormalization:
    """Normalization must be consistent between direct and legacy flows."""

    def test_normalize_pads_short_address(self):
        result = normalize_address("0x4a3")
        assert result == "0x" + "0" * 61 + "4a3"

    def test_normalize_lowercase(self):
        result = normalize_address("0x4A3BcD")
        assert result == "0x" + "0" * 58 + "4a3bcd"

    def test_normalize_full_length(self):
        full = "0x" + "ab" * 32
        result = normalize_address(full)
        assert result == full

    def test_normalize_rejects_invalid_prefix(self):
        with pytest.raises(ValueError, match="must start with 0x"):
            normalize_address("4a3")

    def test_normalize_rejects_invalid_hex(self):
        with pytest.raises(ValueError, match="Invalid hex"):
            normalize_address("0xGGGG")

    def test_matches_wallet_manager_normalization(self):
        """Constraint #7: Normalization must match WalletManager._normalize_address."""
        from src.wallet import WalletManager

        addresses = [
            "0x04a3",
            "0x4A3BcD",
            "0x" + "ab" * 32,
            "0x1",
        ]
        for addr in addresses:
            assert normalize_address(addr) == WalletManager._normalize_address(addr), (
                f"Address normalization mismatch for {addr}"
            )


# ---------------------------------------------------------------------------
# Audit trail logging (constraint #7)
# ---------------------------------------------------------------------------


class TestAuditLogging:
    """Wallet flow type must be logged for security audit trail."""

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flow_logged(self, mock_settings, deps, caplog):
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = "https://smainer-miniapp.vercel.app/?flow=direct"
        mock_settings.telemetry_sensitive_fields = False

        import logging
        with caplog.at_level(logging.INFO, logger="src.handlers"):
            update = _make_update("Test prompt")
            await handle_inference(
                update,
                deps["bot"],
                deps["wallet_mgr"],
                deps["payment_mgr"],
                deps["relayer"],
            )

        assert any("wallet_flow=direct" in record.message for record in caplog.records), (
            "Direct flow type must be logged for audit trail"
        )


# ---------------------------------------------------------------------------
# PaymentVerifier integration in webapp_data handler (constraint #5)
# ---------------------------------------------------------------------------


class TestWebappDataPaymentVerification:
    """PaymentVerifier must be called before task scheduling in webapp flow."""

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_escrow_verification_called(self, mock_settings, mock_verifier_cls, deps):
        """Verify PaymentVerifier.verify_escrow() runs before relayer submission."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_verifier = AsyncMock()
        mock_verifier.verify_escrow.return_value = (True, None)
        mock_verifier_cls.return_value = mock_verifier

        data = {
            "action": "payment_complete",
            "on_chain_task_id": 42,
            "prompt": "test prompt",
            "tier": "small",
            "chat_id": 67890,
            "message_id": 999,
        }
        update = _make_webapp_update(data)

        await handle_webapp_data(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        mock_verifier.verify_escrow.assert_called_once()

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_escrow_verification_blocks_on_failure(self, mock_settings, mock_verifier_cls, deps):
        """When escrow verification fails, task must NOT be submitted."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_verifier = AsyncMock()
        mock_verifier.verify_escrow.return_value = (False, "Address mismatch")
        mock_verifier_cls.return_value = mock_verifier

        data = {
            "action": "payment_complete",
            "on_chain_task_id": 42,
            "prompt": "test prompt",
            "tier": "small",
            "chat_id": 67890,
            "message_id": 999,
        }
        update = _make_webapp_update(data)

        await handle_webapp_data(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        # Task must NOT be submitted to relayer
        deps["relayer"].submit_inference.assert_not_called()

        # User must be notified
        sent_text = deps["bot"].send_message.call_args[1]["text"]
        assert "verification failed" in sent_text.lower()


# ---------------------------------------------------------------------------
# Config: get_direct_pay_url
# ---------------------------------------------------------------------------


class TestDirectPayUrl:
    """Direct pay URL must include flow=direct and required params."""

    def test_url_includes_flow_direct(self):
        from src.config import Settings
        s = Settings(
            telegram_bot_token="test:token",
            miniapp_url="https://smainer-miniapp.vercel.app",
        )
        url = s.get_direct_pay_url(
            prompt="Hello",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="nonce-abc",
        )
        assert "flow=direct" in url
        assert "action=pay" in url
        assert "nonce=nonce-abc" in url
        assert "chat_id=123" in url
        assert "message_id=456" in url

    def test_url_does_not_include_wallet_linked(self):
        """Direct flow URL should NOT include wallet_linked param."""
        from src.config import Settings
        s = Settings(
            telegram_bot_token="test:token",
            miniapp_url="https://smainer-miniapp.vercel.app",
        )
        url = s.get_direct_pay_url(
            prompt="Hello",
            tier="small",
            chat_id=123,
            message_id=456,
        )
        assert "wallet_linked" not in url
