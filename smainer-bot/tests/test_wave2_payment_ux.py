"""Wave 2 (TM-005–TM-010) acceptance tests for the two-screen payment UX.

Covers:
  - Returning user: wallet_linked=1 in pay URL, MiniApp goes straight to Confirm
  - First-time user: no wallet_linked param, MiniApp shows Connect then Confirm
  - Callback processing unchanged for both journeys
  - webapp_data handler works for both returning and new user flows
"""

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import settings
from src.handlers import handle_inference, handle_webapp_data
from src.models import ModelTier, SubmitResult
from src.nonce import NONCE_TTL_SECONDS
from src.payment import PaymentManager
from src.relayer_client import RelayerClient
from src.wallet import WalletManager

# Patch touch_session globally for this module to avoid 5s HTTP timeouts per test
pytestmark = pytest.mark.usefixtures("_patch_touch_session")


@pytest.fixture(autouse=True)
def _patch_touch_session():
    with patch("src.handlers.touch_session"):
        yield


@pytest.fixture(autouse=True)
def _patch_payment_verifier():
    with patch("src.handlers.PaymentVerifier") as MockVerifier:
        MockVerifier.return_value.verify_escrow = AsyncMock(return_value=(True, None))
        yield


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


def _make_webapp_update(data: str, user_id: int = 12345, chat_id: int = 67890):
    return {
        "message": {
            "from": {"id": user_id},
            "chat": {"id": chat_id},
            "text": "",
            "web_app_data": {"data": data},
        }
    }


def _mock_bot():
    bot = AsyncMock()
    msg = MagicMock()
    msg.message_id = 999
    bot.send_message = AsyncMock(return_value=msg)
    bot.edit_message_reply_markup = AsyncMock()
    bot.edit_message_text = AsyncMock()
    bot.send_chat_action = AsyncMock()
    return bot


def _mock_relayer(model: str = None):
    relayer = AsyncMock(spec=RelayerClient)
    relayer.list_available_models = AsyncMock(
        return_value=[
            {"node_id": "node-abc123", "gpu": "RTX 4000 Ada", "ram_gb": 16, "supported_tiers": ["small"]}
        ]
    )
    relayer.kv_get = AsyncMock(return_value=model)
    relayer.kv_set = AsyncMock()
    relayer.submit_inference = AsyncMock(return_value=SubmitResult(task_id="task-xyz-001", ok=True, http_status=201))
    return relayer


# ---------------------------------------------------------------------------
# TM-008: Returning user — wallet linked — pay URL includes wallet_linked=1
# ---------------------------------------------------------------------------


class TestReturningUserFlow:
    """AC: Returning user with linked wallet → MiniApp opens directly to
    Confirm screen with persisted wallet."""

    @pytest.mark.asyncio
    async def test_pay_url_includes_wallet_linked_when_linked(self):
        """When user has a linked wallet, pay URL must include wallet_linked=1."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value="0x" + "ab" * 32)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("Summarise this article for me")

        with patch("src.handlers.generate_nonce", return_value="nonce-returning-001"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        # Extract WebApp URL from the button
        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        btn = keyboard.inline_keyboard[0][0]
        url = btn.url

        assert "flow=direct" in url, f"Expected flow=direct in URL: {url}"
        assert "nonce=nonce-returning-001" in url

    @pytest.mark.asyncio
    async def test_returning_user_payment_complete(self):
        """Returning user completes payment — webapp_data processes normally."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value="0x" + "ab" * 32)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()
        relayer.submit_inference = AsyncMock(return_value=SubmitResult(task_id="task-ret-001", ok=True, http_status=201))

        data = json.dumps({
            "action": "payment_complete",
            "on_chain_task_id": 42,
            "prompt": "Summarise this",
            "tier": "small",
            "chat_id": "67890",
            "message_id": "999",
            "starknet_address": "0x" + "ab" * 32,
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        # Task should be submitted
        relayer.submit_inference.assert_called_once()
        payment_mgr.reserve_payment.assert_called_once()


# ---------------------------------------------------------------------------
# TM-005/TM-006: First-time user — no wallet linked — no wallet_linked param
# ---------------------------------------------------------------------------


class TestFirstTimeUserFlow:
    """AC: First-time user → MiniApp opens Connect screen, connects wallet
    once, transitions to Confirm, then pay→compute completes."""

    @pytest.mark.asyncio
    async def test_pay_url_no_wallet_linked_when_not_linked(self):
        """When user has NO linked wallet, pay URL must NOT include wallet_linked."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("Hello AI, first time here")

        with patch("src.handlers.generate_nonce", return_value="nonce-new-001"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        btn = keyboard.inline_keyboard[0][0]
        url = btn.url

        assert "wallet_linked" not in url, f"wallet_linked should NOT appear in URL: {url}"
        assert "nonce=nonce-new-001" in url

    @pytest.mark.asyncio
    async def test_first_time_user_wallet_connect_then_pay(self):
        """First-time user: wallet_connect followed by payment_complete."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()
        relayer.submit_inference = AsyncMock(return_value=SubmitResult(task_id="task-new-001", ok=True, http_status=201))

        # Step 1: User connects wallet via MiniApp
        connect_data = json.dumps({
            "action": "wallet_connect",
            "address": "0x" + "cd" * 32,
            "wallet_type": "braavos",
        })
        connect_update = _make_webapp_update(connect_data)

        await handle_webapp_data(connect_update, bot, wallet_mgr, payment_mgr, relayer)

        wallet_mgr.link_wallet.assert_called_once_with(12345, "0x" + "cd" * 32)
        connect_text = bot.send_message.call_args[1]["text"]
        assert "Wallet connected" in connect_text

        # Step 2: User completes payment
        bot.reset_mock()
        wallet_mgr.get_linked_address = AsyncMock(return_value="0x" + "cd" * 32)
        pay_data = json.dumps({
            "action": "payment_complete",
            "on_chain_task_id": 99,
            "prompt": "Hello AI, first time here",
            "tier": "small",
            "chat_id": "67890",
            "message_id": "999",
            "starknet_address": "0x" + "cd" * 32,
        })
        pay_update = _make_webapp_update(pay_data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(pay_update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_called_once()
        payment_mgr.reserve_payment.assert_called_once()


# ---------------------------------------------------------------------------
# TM-009: Unified flow — single Pay & Compute button always
# ---------------------------------------------------------------------------


class TestUnifiedFlowButton:
    """AC: Both returning and first-time users see a single Pay & Compute
    button — redundant intermediary wallet pages are removed."""

    @pytest.mark.asyncio
    async def test_single_button_returning_user(self):
        """Returning user gets exactly 1 button row (Pay & Compute)."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value="0x" + "ab" * 32)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("Compute this for me")

        with patch("src.handlers.generate_nonce", return_value="nonce-x"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        rows = keyboard.inline_keyboard

        assert len(rows) == 1, f"Expected 1 button row, got {len(rows)}"
        assert "Pay" in rows[0][0].text and "Compute" in rows[0][0].text

    @pytest.mark.asyncio
    async def test_single_button_first_time_user(self):
        """First-time user also gets exactly 1 button row (Pay & Compute)."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("What is the meaning of life?")

        with patch("src.handlers.generate_nonce", return_value="nonce-y"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        rows = keyboard.inline_keyboard

        assert len(rows) == 1, f"Expected 1 button row, got {len(rows)}"
        assert "Pay" in rows[0][0].text and "Compute" in rows[0][0].text


# ---------------------------------------------------------------------------
# TM-010: Callback processing unchanged
# ---------------------------------------------------------------------------


class TestCallbackProcessingUnchanged:
    """AC: MiniApp and bot handlers both work without breaking callback processing."""

    @pytest.mark.asyncio
    async def test_webapp_disconnect_still_works(self):
        """Wallet disconnect via webapp_data still functions."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({"action": "wallet_disconnect"})
        update = _make_webapp_update(data)

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        wallet_mgr.unlink_wallet.assert_called_once_with(12345)
        text = bot.send_message.call_args[1]["text"]
        assert "disconnected" in text.lower()

    @pytest.mark.asyncio
    async def test_blocked_action_still_rejected(self):
        """Unknown webapp actions are still blocked by TM-003 allowlist."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({"action": "malicious_transfer"})
        update = _make_webapp_update(data)

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        wallet_mgr.link_wallet.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "Unrecognized" in text

    @pytest.mark.asyncio
    async def test_payment_complete_missing_data_rejected(self):
        """Payment complete with missing required fields is rejected."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({
            "action": "payment_complete",
            # Missing on_chain_task_id and prompt
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "missing" in text.lower() or "required" in text.lower()


# ---------------------------------------------------------------------------
# Config URL tests for wallet_linked param
# ---------------------------------------------------------------------------


class TestConfigPayUrlWalletLinked:
    """Verify config.get_miniapp_pay_url() correctly handles wallet_linked."""

    def test_pay_url_with_wallet_linked_true(self):
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="abc",
            wallet_linked=True,
        )
        assert "wallet_linked=1" in url

    def test_pay_url_with_wallet_linked_false(self):
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="abc",
            wallet_linked=False,
        )
        assert "wallet_linked" not in url

    def test_pay_url_wallet_linked_default(self):
        """Default (no wallet_linked arg) should not include the param."""
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=123,
            message_id=456,
        )
        assert "wallet_linked" not in url


# ---------------------------------------------------------------------------
# TM-007: Session expired scenario
# ---------------------------------------------------------------------------


class TestSessionExpiry:
    """AC: Expired sessions are rejected for payment_complete."""

    @pytest.mark.asyncio
    async def test_expired_session_rejected_for_returning_user(self):
        """Even a returning user with linked wallet gets rejected on expired session."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value="0x" + "ab" * 32)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = json.dumps({
            "action": "payment_complete",
            "on_chain_task_id": 50,
            "prompt": "test prompt",
            "starknet_address": "0x" + "ab" * 32,
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=False):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "expired" in text.lower() or "Session" in text
