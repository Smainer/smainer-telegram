"""TM-013: End-to-end validation — Wave 3.

Comprehensive test scenarios covering the complete pay-and-compute flow for
both new and returning users across bot, miniapp, wallet, and relayer systems.

Test matrix:
  Scenario 1: First-time user full flow (bot → wallet connect → confirm → approve → callback → complete)
  Scenario 2: Returning user full flow (bot → confirm → approve → callback → complete)
  Scenario 3: MiniApp paths parity (same outcomes as bot paths)
  Scenario 4: Error scenarios (wallet rejection, timeout, network issues)
  Scenario 5: Session persistence (survives idle within window, expires after 15 min)
"""

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.callback_auth import verify_callback_signature
from src.config import settings
from src.handlers import (
    ALLOWED_WEBAPP_ACTIONS,
    handle_balance,
    handle_help,
    handle_inference,
    handle_link,
    handle_models,
    handle_start,
    handle_unlink,
    handle_webapp_data,
)
from src.models import InferenceRequest, ModelTier, SubmitResult, TaskCallback
from src.nonce import NONCE_TTL_SECONDS
from src.payment import PaymentManager
from src.relayer_client import RelayerClient
from src.session import SESSION_IDLE_TIMEOUT_SECONDS
from src.wallet import BalanceUnavailableError, WalletManager


# Patch touch_session globally to avoid 5s HTTP timeouts per test
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
# Shared helpers
# ---------------------------------------------------------------------------

USER_ID = 12345
CHAT_ID = 67890
ADDRESS = "0x" + "ab" * 32
ADDRESS_ALT = "0x" + "cd" * 32


def _make_update(text: str, user_id: int = USER_ID, chat_id: int = CHAT_ID):
    return {
        "message": {
            "from": {"id": user_id},
            "chat": {"id": chat_id},
            "text": text,
        }
    }


def _make_webapp_update(data: str, user_id: int = USER_ID, chat_id: int = CHAT_ID):
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


def _mock_relayer():
    relayer = AsyncMock(spec=RelayerClient)
    relayer.list_available_models = AsyncMock(
        return_value=[
            {"node_id": "node-abc123", "gpu": "RTX 4000 Ada", "ram_gb": 16, "supported_tiers": ["small"]}
        ]
    )
    relayer.kv_get = AsyncMock(return_value=None)
    relayer.kv_set = AsyncMock()
    relayer.submit_inference = AsyncMock(return_value=SubmitResult(task_id="task-e2e-001", ok=True, http_status=201))
    return relayer


def _payment_complete_data(
    on_chain_task_id: int = 42,
    prompt: str = "Hello AI",
    starknet_address: str = ADDRESS,
):
    return json.dumps({
        "action": "payment_complete",
        "on_chain_task_id": on_chain_task_id,
        "prompt": prompt,
        "tier": "small",
        "chat_id": str(CHAT_ID),
        "message_id": "999",
        "starknet_address": starknet_address,
    })


# =========================================================================
# SCENARIO 1: First-time user full flow
#   bot message → wallet connect → confirm → approve → auto-return → compute complete
# =========================================================================


class TestScenario1_FirstTimeUser:
    """E2E: Brand-new user with no wallet sends a prompt, connects wallet
    through MiniApp, pays on-chain, task is submitted, callback delivers result."""

    @pytest.mark.asyncio
    async def test_step1_prompt_shows_pay_button_without_wallet_linked(self):
        """User sends text → bot shows 'Pay & Compute' WITHOUT wallet_linked param."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("Explain quantum computing")

        with patch("src.handlers.generate_nonce", return_value="nonce-first-001"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        # Bot should show a placeholder then update button
        assert bot.send_message.called
        assert bot.edit_message_reply_markup.called

        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        rows = keyboard.inline_keyboard

        # Exactly 1 button: Pay & Compute
        assert len(rows) == 1
        btn = rows[0][0]
        assert "Pay" in btn.text and "Compute" in btn.text

        # URL should NOT contain wallet_linked
        assert "wallet_linked" not in btn.url
        # URL should contain nonce
        assert "nonce=nonce-first-001" in btn.url

    @pytest.mark.asyncio
    async def test_step2_wallet_connect_via_miniapp(self):
        """MiniApp sends wallet_connect → bot stores wallet and confirms."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({
            "action": "wallet_connect",
            "address": ADDRESS_ALT,
            "wallet_type": "braavos",
        })
        update = _make_webapp_update(data)

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        wallet_mgr.link_wallet.assert_called_once_with(USER_ID, ADDRESS_ALT)
        text = bot.send_message.call_args[1]["text"]
        assert "Wallet connected" in text
        assert ADDRESS_ALT in text

    @pytest.mark.asyncio
    async def test_step3_payment_complete_submits_task(self):
        """MiniApp sends payment_complete → bot submits task to relayer."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS_ALT)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = _payment_complete_data(
            on_chain_task_id=100,
            prompt="Explain quantum computing",
            starknet_address=ADDRESS_ALT,
        )
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_called_once()
        payment_mgr.reserve_payment.assert_called_once()

        # Verify task submission includes on_chain_task_id
        submit_call = relayer.submit_inference.call_args
        assert submit_call[1]["on_chain_task_id"] == 100 or submit_call[0][1] == 100

    @pytest.mark.asyncio
    async def test_step4_callback_delivers_result(self):
        """Relayer callback delivers completed result → bot edits message."""
        callback = TaskCallback(
            task_id="task-e2e-001",
            status="completed",
            result={"result": "Quantum computing uses qubits..."},
            execution_time=3.2,
            chat_id=CHAT_ID,
            message_id=999,
            model="llama3.1:8b",
            on_chain_task_id=100,
        )

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.Bot", return_value=mock_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, CHAT_ID, 999)

        mock_bot.edit_message_text.assert_called()
        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert call_kwargs["chat_id"] == CHAT_ID
        assert call_kwargs["message_id"] == 999
        assert "Quantum computing" in call_kwargs["text"] or "qubits" in call_kwargs["text"]

    @pytest.mark.asyncio
    async def test_full_first_time_flow_sequential(self):
        """Full sequential flow: prompt → connect → pay → callback."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        # Step 1: User sends prompt
        update = _make_update("Summarize machine learning")
        with patch("src.handlers.generate_nonce", return_value="nonce-full-001"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        assert bot.edit_message_reply_markup.called
        url = bot.edit_message_reply_markup.call_args[1]["reply_markup"].inline_keyboard[0][0].url
        assert "wallet_linked" not in url

        # Step 2: User connects wallet via MiniApp
        bot.reset_mock()
        connect_data = json.dumps({
            "action": "wallet_connect",
            "address": ADDRESS,
            "wallet_type": "argentx",
        })
        await handle_webapp_data(_make_webapp_update(connect_data), bot, wallet_mgr, payment_mgr, relayer)
        wallet_mgr.link_wallet.assert_called_once()

        # Step 3: User completes payment
        bot.reset_mock()
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        pay_data = _payment_complete_data(on_chain_task_id=200, prompt="Summarize machine learning")
        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(_make_webapp_update(pay_data), bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_called_once()
        payment_mgr.reserve_payment.assert_called()

        # Step 4: Callback delivers result
        callback = TaskCallback(
            task_id="task-e2e-001",
            status="completed",
            result={"result": "ML is a subset of AI..."},
            execution_time=2.1,
            chat_id=CHAT_ID,
            message_id=999,
            model="llama3.1:8b",
        )
        mock_cb_bot = AsyncMock()
        with patch("api.callback.complete.Bot", return_value=mock_cb_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, CHAT_ID, 999)

        mock_cb_bot.edit_message_text.assert_called()


# =========================================================================
# SCENARIO 2: Returning user full flow
#   bot message → confirm → approve → auto-return → compute complete
# =========================================================================


class TestScenario2_ReturningUser:
    """E2E: User with existing linked wallet sends a prompt, gets pay button
    with wallet_linked=1, pays, task runs, callback completes."""

    @pytest.mark.asyncio
    async def test_step1_prompt_shows_pay_button_with_wallet_linked(self):
        """Returning user → bot shows 'Pay & Compute' WITH wallet_linked=1."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        update = _make_update("What is Starknet?")

        with patch("src.handlers.generate_nonce", return_value="nonce-ret-001"):
            await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        call_kwargs = bot.edit_message_reply_markup.call_args[1]
        keyboard = call_kwargs["reply_markup"]
        btn = keyboard.inline_keyboard[0][0]

        assert "Pay" in btn.text and "Compute" in btn.text
        assert "flow=direct" in btn.url
        assert "nonce=nonce-ret-001" in btn.url

    @pytest.mark.asyncio
    async def test_step2_payment_complete_no_connect_needed(self):
        """Returning user pays directly — no wallet_connect step needed."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = _payment_complete_data(on_chain_task_id=300, prompt="What is Starknet?")
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        # Should NOT call link_wallet (already linked)
        wallet_mgr.link_wallet.assert_not_called()
        # Should submit inference
        relayer.submit_inference.assert_called_once()
        payment_mgr.reserve_payment.assert_called_once()

    @pytest.mark.asyncio
    async def test_step3_callback_success(self):
        """Callback delivers result for returning user task."""
        callback = TaskCallback(
            task_id="task-ret-e2e",
            status="completed",
            result={"result": "Starknet is a ZK-rollup..."},
            execution_time=1.8,
            chat_id=CHAT_ID,
            message_id=999,
            model="llama3.1:8b",
        )

        mock_bot = AsyncMock()
        with patch("api.callback.complete.Bot", return_value=mock_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, CHAT_ID, 999)

        mock_bot.edit_message_text.assert_called()
        text = mock_bot.edit_message_text.call_args[1]["text"]
        assert "Starknet" in text or "ZK" in text

    @pytest.mark.asyncio
    async def test_full_returning_flow_sequential(self):
        """Full sequential: prompt (wallet_linked) → pay → callback."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        # Step 1: Prompt
        with patch("src.handlers.generate_nonce", return_value="nonce-full-ret"):
            await handle_inference(_make_update("How does STARK proving work?"), bot, wallet_mgr, payment_mgr, relayer)

        url = bot.edit_message_reply_markup.call_args[1]["reply_markup"].inline_keyboard[0][0].url
        assert "flow=direct" in url

        # Step 2: Payment (no connect step)
        bot.reset_mock()
        data = _payment_complete_data(on_chain_task_id=400, prompt="How does STARK proving work?")
        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(_make_webapp_update(data), bot, wallet_mgr, payment_mgr, relayer)
        relayer.submit_inference.assert_called_once()

        # Step 3: Callback
        callback = TaskCallback(
            task_id="task-e2e-001",
            status="completed",
            result={"result": "STARK proofs use polynomial commitments..."},
            execution_time=4.0,
            chat_id=CHAT_ID,
            message_id=999,
        )
        mock_cb_bot = AsyncMock()
        with patch("api.callback.complete.Bot", return_value=mock_cb_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, CHAT_ID, 999)
        mock_cb_bot.edit_message_text.assert_called()


# =========================================================================
# SCENARIO 3: MiniApp paths parity
#   Verify MiniApp wallet_connect and payment_complete produce identical
#   outcomes regardless of user entry point (bot vs miniapp).
# =========================================================================


class TestScenario3_MiniAppParity:
    """Verify MiniApp data paths produce the same outcomes as bot command paths."""

    @pytest.mark.asyncio
    async def test_wallet_connect_via_miniapp_matches_link_command(self):
        """wallet_connect action stores same data as /link command."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        # MiniApp path
        miniapp_data = json.dumps({
            "action": "wallet_connect",
            "address": ADDRESS,
            "wallet_type": "argentx",
        })
        await handle_webapp_data(_make_webapp_update(miniapp_data), bot, wallet_mgr, payment_mgr, relayer)
        miniapp_call = wallet_mgr.link_wallet.call_args

        # Bot command path
        wallet_mgr.reset_mock()
        bot.reset_mock()
        await handle_link(_make_update(f"/link {ADDRESS}"), bot, wallet_mgr)
        bot_call = wallet_mgr.link_wallet.call_args

        # Both store same user_id + address
        assert miniapp_call[0] == bot_call[0]

    @pytest.mark.asyncio
    async def test_wallet_disconnect_via_miniapp_matches_unlink_command(self):
        """wallet_disconnect action produces same effect as /unlink."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        # MiniApp path
        data = json.dumps({"action": "wallet_disconnect"})
        with patch("src.handlers.invalidate_session"):
            await handle_webapp_data(_make_webapp_update(data), bot, wallet_mgr, payment_mgr, relayer)
        miniapp_call = wallet_mgr.unlink_wallet.call_args

        # Bot command path
        wallet_mgr.reset_mock()
        bot.reset_mock()
        with patch("src.handlers.invalidate_session"):
            await handle_unlink(_make_update("/unlink"), bot, wallet_mgr)
        bot_call = wallet_mgr.unlink_wallet.call_args

        assert miniapp_call[0] == bot_call[0]

    @pytest.mark.asyncio
    async def test_payment_complete_produces_same_task_submission(self):
        """payment_complete from MiniApp results in same relayer submission."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = _payment_complete_data(on_chain_task_id=500, prompt="Test parity")
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_called_once()
        call_args = relayer.submit_inference.call_args

        # Verify the InferenceRequest has correct fields
        req = call_args[0][0]
        assert isinstance(req, InferenceRequest)
        assert req.telegram_user_id == USER_ID
        assert req.chat_id == CHAT_ID
        assert req.prompt == "Test parity"
        assert req.starknet_address == ADDRESS

    @pytest.mark.asyncio
    async def test_callback_result_identical_for_both_flows(self):
        """Task callback delivers identical Telegram edits regardless of how
        the task was submitted (MiniApp or bot)."""
        for flow_name, task_id in [("miniapp", "task-mini-001"), ("bot", "task-bot-001")]:
            callback = TaskCallback(
                task_id=task_id,
                status="completed",
                result={"result": f"Result from {flow_name}"},
                execution_time=2.0,
                chat_id=CHAT_ID,
                message_id=999,
                model="llama3.1:8b",
            )

            mock_bot = AsyncMock()
            with patch("api.callback.complete.Bot", return_value=mock_bot):
                from api.callback.complete import _handle_task_complete
                await _handle_task_complete(callback, CHAT_ID, 999)

            mock_bot.edit_message_text.assert_called()
            text = mock_bot.edit_message_text.call_args[1]["text"]
            assert f"Result from {flow_name}" in text


# =========================================================================
# SCENARIO 4: Error scenarios
#   wallet rejection, timeout, network issues
# =========================================================================


class TestScenario4_ErrorScenarios:
    """Error handling across the pay-and-compute flow."""

    # -- 4a: Wallet rejection / invalid address --

    @pytest.mark.asyncio
    async def test_invalid_wallet_address_rejected(self):
        """wallet_connect with invalid address is rejected gracefully."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.link_wallet = AsyncMock(side_effect=ValueError("Invalid Starknet address"))
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({
            "action": "wallet_connect",
            "address": "not-a-valid-address",
            "wallet_type": "argentx",
        })
        update = _make_webapp_update(data)

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        text = bot.send_message.call_args[1]["text"]
        assert "Invalid" in text or "invalid" in text

    @pytest.mark.asyncio
    async def test_wallet_connect_missing_address(self):
        """wallet_connect with no address field is rejected."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({
            "action": "wallet_connect",
            # Missing "address"
            "wallet_type": "braavos",
        })
        update = _make_webapp_update(data)

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        wallet_mgr.link_wallet.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "No wallet address" in text or "address" in text.lower()

    # -- 4b: Malformed / invalid webapp data --

    @pytest.mark.asyncio
    async def test_malformed_json_webapp_data(self):
        """Completely invalid JSON in webapp data is handled gracefully."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        update = _make_webapp_update("this is not JSON")

        await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        text = bot.send_message.call_args[1]["text"]
        assert "Failed" in text or "try again" in text.lower()

    @pytest.mark.asyncio
    async def test_unknown_action_blocked_by_allowlist(self):
        """Actions not in ALLOWED_WEBAPP_ACTIONS are blocked (TM-003)."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        for bad_action in ["admin_override", "transfer_funds", "delete_wallet", ""]:
            bot.reset_mock()
            data = json.dumps({"action": bad_action})
            update = _make_webapp_update(data)

            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

            text = bot.send_message.call_args[1]["text"]
            assert "Unrecognized" in text or "Failed" in text

    # -- 4c: Payment with missing required data --

    @pytest.mark.asyncio
    async def test_payment_complete_missing_on_chain_task_id(self):
        """payment_complete without on_chain_task_id is rejected."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = json.dumps({
            "action": "payment_complete",
            "prompt": "Missing task ID",
            # Missing on_chain_task_id
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()

    @pytest.mark.asyncio
    async def test_payment_complete_missing_prompt(self):
        """payment_complete without prompt is rejected."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = json.dumps({
            "action": "payment_complete",
            "on_chain_task_id": 55,
            # Missing prompt
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()

    # -- 4d: No wallet for payment --

    @pytest.mark.asyncio
    async def test_payment_complete_no_wallet_anywhere(self):
        """payment_complete when no wallet is available anywhere is rejected."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=None)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        # Omit starknet_address from payload and wallet not linked
        data = json.dumps({
            "action": "payment_complete",
            "on_chain_task_id": 66,
            "prompt": "No wallet test",
        })
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "wallet" in text.lower() or "Wallet" in text

    # -- 4e: Relayer submission failure --

    @pytest.mark.asyncio
    async def test_relayer_submission_failure_returns_error(self):
        """When relayer.submit_inference returns None, user sees error message."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()
        relayer.submit_inference = AsyncMock(return_value=SubmitResult(ok=False, error_code="rejected", error_detail="Test failure"))  # failure

        data = _payment_complete_data(on_chain_task_id=77, prompt="Relayer fail test")
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        # Should show failure message
        assert bot.edit_message_text.called
        call_kwargs = bot.edit_message_text.call_args[1]
        assert "Failed" in call_kwargs["text"] or "failed" in call_kwargs["text"]

    # -- 4f: No compute nodes online --

    @pytest.mark.asyncio
    async def test_no_compute_nodes_online(self):
        """When no nodes are available, user gets clear message."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()
        relayer.list_available_models = AsyncMock(return_value=[])

        update = _make_update("Compute when no nodes")

        await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        text = bot.send_message.call_args[1]["text"]
        assert "No compute nodes" in text or "no nodes" in text.lower()

    # -- 4g: Tier incompatibility --

    @pytest.mark.asyncio
    async def test_tier_incompatible_shows_available_tiers(self):
        """When user's model tier doesn't match any node, show available tiers."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()
        relayer.list_available_models = AsyncMock(
            return_value=[
                {"node_id": "n1", "gpu": "RTX 3060", "ram_gb": 12, "supported_tiers": ["small"]}
            ]
        )
        # User wants a 70b model (large tier) but only small-tier nodes exist
        relayer.kv_get = AsyncMock(return_value="llama3.1:70b")

        update = _make_update("Complex question needing big model")

        await handle_inference(update, bot, wallet_mgr, payment_mgr, relayer)

        text = bot.send_message.call_args[1]["text"]
        assert "small" in text.lower() or "tier" in text.lower()

    # -- 4h: Callback with failed status --

    @pytest.mark.asyncio
    async def test_callback_failed_task_shows_error(self):
        """When relayer callback reports failure, user sees error message."""
        callback = TaskCallback(
            task_id="task-fail-001",
            status="failed",
            error="GPU out of memory",
            chat_id=CHAT_ID,
            message_id=999,
        )

        mock_bot = AsyncMock()
        with patch("api.callback.complete.Bot", return_value=mock_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, CHAT_ID, 999)

        text = mock_bot.edit_message_text.call_args[1]["text"]
        assert "GPU out of memory" in text

    # -- 4i: Balance unavailable --

    @pytest.mark.asyncio
    async def test_balance_unavailable_graceful(self):
        """When Starknet RPC is unreachable, balance check degrades gracefully."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        wallet_mgr.get_strk_balance = AsyncMock(side_effect=BalanceUnavailableError("RPC timeout"))

        update = _make_update("/balance")

        await handle_balance(update, bot, wallet_mgr)

        text = bot.send_message.call_args[1]["text"]
        assert "unavailable" in text.lower() or "try again" in text.lower()

    # -- 4j: Callback signature verification --

    def test_callback_invalid_signature_rejected(self):
        """Invalid HMAC signature on callback is rejected."""
        raw_body = b'{"task_id":"t1","status":"completed"}'
        timestamp = str(int(time.time()))

        result = verify_callback_signature(
            raw_body=raw_body,
            timestamp=timestamp,
            sig_header="deadbeef" * 8,  # wrong signature
        )

        assert result is False

    def test_callback_expired_timestamp_rejected(self):
        """Callback with timestamp older than tolerance is rejected."""
        raw_body = b'{"task_id":"t1","status":"completed"}'
        old_timestamp = str(int(time.time()) - 600)  # 10 minutes ago

        result = verify_callback_signature(
            raw_body=raw_body,
            timestamp=old_timestamp,
            sig_header="anything",
        )

        assert result is False


# =========================================================================
# SCENARIO 5: Session persistence
#   Session survives within idle window, expires after 15 minutes
# =========================================================================


class TestScenario5_SessionPersistence:
    """Session management and timeout behavior."""

    @pytest.mark.asyncio
    async def test_active_session_allows_payment(self):
        """Payment succeeds when session is active (not expired)."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = _payment_complete_data(on_chain_task_id=800)
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=True):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_called_once()

    @pytest.mark.asyncio
    async def test_expired_session_rejects_payment(self):
        """Payment is rejected when session has expired (15 min idle)."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = _mock_relayer()

        data = _payment_complete_data(on_chain_task_id=801)
        update = _make_webapp_update(data)

        with patch("src.handlers.check_session_active", return_value=False):
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

        relayer.submit_inference.assert_not_called()
        text = bot.send_message.call_args[1]["text"]
        assert "expired" in text.lower() or "Session" in text

    @pytest.mark.asyncio
    async def test_session_timeout_constant_is_15_minutes(self):
        """Verify session idle timeout is exactly 900 seconds (15 minutes)."""
        assert SESSION_IDLE_TIMEOUT_SECONDS == 900

    @pytest.mark.asyncio
    async def test_unlink_invalidates_session(self):
        """Unlinking wallet invalidates the session."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)

        with patch("src.handlers.invalidate_session") as mock_invalidate:
            await handle_unlink(_make_update("/unlink"), bot, wallet_mgr)
            mock_invalidate.assert_called_once_with(USER_ID)

    @pytest.mark.asyncio
    async def test_wallet_disconnect_invalidates_session(self):
        """Disconnecting wallet via MiniApp invalidates the session."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)
        payment_mgr = AsyncMock(spec=PaymentManager)
        relayer = AsyncMock(spec=RelayerClient)

        data = json.dumps({"action": "wallet_disconnect"})
        update = _make_webapp_update(data)

        with patch("src.handlers.invalidate_session") as mock_invalidate:
            await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)
            mock_invalidate.assert_called_once_with(USER_ID)

    @pytest.mark.asyncio
    async def test_start_command_touches_session(self):
        """The /start command creates/refreshes a session."""
        bot = _mock_bot()
        wallet_mgr = AsyncMock(spec=WalletManager)

        # Re-enable touch_session for this specific test
        with patch("src.handlers.touch_session") as mock_touch:
            # Need to temporarily undo the autouse fixture
            await handle_start(_make_update("/start"), bot, wallet_mgr)
            mock_touch.assert_called()


# =========================================================================
# SCENARIO CROSS-CUTTING: Allowlist enforcement
# =========================================================================


class TestAllowlistEnforcement:
    """Verify only ALLOWED_WEBAPP_ACTIONS are processed (TM-003)."""

    def test_allowed_actions_list_is_complete(self):
        """The allowlist contains exactly the expected actions."""
        expected = {"wallet_connect", "wallet_disconnect", "payment_complete"}
        assert ALLOWED_WEBAPP_ACTIONS == expected

    @pytest.mark.asyncio
    async def test_all_allowed_actions_accepted(self):
        """Every action in ALLOWED_WEBAPP_ACTIONS is accepted (not rejected by allowlist)."""
        for action in ALLOWED_WEBAPP_ACTIONS:
            bot = _mock_bot()
            wallet_mgr = AsyncMock(spec=WalletManager)
            wallet_mgr.get_linked_address = AsyncMock(return_value=ADDRESS)
            payment_mgr = AsyncMock(spec=PaymentManager)
            relayer = _mock_relayer()

            # Build minimal valid data for each action
            if action == "wallet_connect":
                data = json.dumps({"action": action, "address": ADDRESS})
            elif action == "payment_complete":
                data = _payment_complete_data()
            else:
                data = json.dumps({"action": action})

            update = _make_webapp_update(data)

            with patch("src.handlers.check_session_active", return_value=True):
                await handle_webapp_data(update, bot, wallet_mgr, payment_mgr, relayer)

            # Check that "Unrecognized" is NOT in the response
            if bot.send_message.called:
                last_text = bot.send_message.call_args[1]["text"]
                assert "Unrecognized" not in last_text, (
                    f"Action '{action}' should be accepted but got: {last_text}"
                )


# =========================================================================
# SCENARIO CROSS-CUTTING: Config URL generation
# =========================================================================


class TestPayUrlGeneration:
    """Verify MiniApp pay URL structure for both user types."""

    def test_pay_url_structure_new_user(self):
        """New user URL has prompt, tier, chat_id, message_id, nonce — no wallet_linked."""
        url = settings.get_miniapp_pay_url(
            prompt="test prompt",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="abc123",
            wallet_linked=False,
        )
        assert "action=pay" in url
        assert "prompt=test+prompt" in url or "prompt=test%20prompt" in url
        assert "tier=small" in url
        assert "chat_id=123" in url
        assert "message_id=456" in url
        assert "nonce=abc123" in url
        assert "wallet_linked" not in url

    def test_pay_url_structure_returning_user(self):
        """Returning user URL has all params plus wallet_linked=1."""
        url = settings.get_miniapp_pay_url(
            prompt="test prompt",
            tier="small",
            chat_id=123,
            message_id=456,
            nonce="abc123",
            wallet_linked=True,
        )
        assert "wallet_linked=1" in url
        assert "nonce=abc123" in url

    def test_pay_url_base_is_miniapp_url(self):
        """URL starts with the configured miniapp_url."""
        url = settings.get_miniapp_pay_url(
            prompt="test",
            tier="small",
            chat_id=1,
            message_id=2,
        )
        assert url.startswith(settings.miniapp_url)


# =========================================================================
# SCENARIO CROSS-CUTTING: Callback processing HTTP layer
# =========================================================================


class TestCallbackHTTPLayer:
    """Verify the callback HTTP handler correctly routes to _handle_task_complete."""

    def test_completed_callback_returns_200(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        body = json.dumps({
            "task_id": "t-e2e-1",
            "status": "completed",
            "result": {"result": "E2E result"},
            "execution_time": 1.5,
            "chat_id": CHAT_ID,
            "message_id": 999,
        }).encode()
        h.headers = {
            "Content-Length": str(len(body)),
            "X-Smainer-Signature": "sig",
            "X-Smainer-Timestamp": "123",
            "X-Forwarded-For": "10.0.0.1",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = body
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.send_header = MagicMock()
        h.client_address = ("10.0.0.1", 12345)

        with (
            patch("api.callback.complete.verify_callback_signature", return_value=True),
            patch("api.callback.complete.asyncio") as mock_asyncio,
            patch("api.callback.complete.check_rate_limit_by_ip", return_value=True),
        ):
            mock_asyncio.run = MagicMock()
            h.do_POST()

        h.send_response.assert_called_with(200)

    def test_missing_routing_returns_400(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        body = json.dumps({
            "task_id": "t-e2e-2",
            "status": "completed",
            "result": {"result": "Missing routing"},
            # No chat_id or message_id
        }).encode()
        h.headers = {
            "Content-Length": str(len(body)),
            "X-Smainer-Signature": "sig",
            "X-Smainer-Timestamp": "123",
            "X-Forwarded-For": "10.0.0.1",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = body
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.send_header = MagicMock()
        h.client_address = ("10.0.0.1", 12345)

        with (
            patch("api.callback.complete.verify_callback_signature", return_value=True),
            patch("api.callback.complete.check_rate_limit_by_ip", return_value=True),
        ):
            h.do_POST()

        h.send_response.assert_called_with(400)

    def test_invalid_signature_returns_401(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        body = b'{"task_id":"t1","status":"completed"}'
        h.headers = {
            "Content-Length": str(len(body)),
            "X-Smainer-Signature": "badsig",
            "X-Smainer-Timestamp": str(int(time.time())),
            "X-Forwarded-For": "10.0.0.1",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = body
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.client_address = ("10.0.0.1", 12345)

        with patch("api.callback.complete.check_rate_limit_by_ip", return_value=True), \
             patch("api.callback.complete.verify_callback_signature", return_value=False):
            h.do_POST()

        h.send_response.assert_called_with(401)
