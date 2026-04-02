"""Tests for Wave 1 — Direct-flow hardening (Option D).

Validates:
- Relayer 402 / 502 handled with user-friendly messages
- Delayed verification retries on "not found" then succeeds
- Delayed verification retries then fails closed
- Audit metric logs at each stage: flow-selected, approval-complete,
  verification-failed, compute-submitted, compute-result-delivered
- Feature-flag rollback still works (no regression)
- SubmitResult carries structured error info
"""

import asyncio
import json
import logging
import os
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
from src.models import ModelTier, SubmitResult
from src.payment import PaymentManager
from src.payment_verifier import PaymentVerifier
from src.relayer_client import RelayerClient
from src.wallet import WalletManager

# Patch session operations globally
_session_patch_touch = patch("src.handlers.touch_session", return_value=None)
_session_patch_check = patch("src.handlers.check_session_active", return_value=True)
_session_patch_invalidate = patch("src.handlers.invalidate_session", return_value=None)
_nonce_patch = patch("src.handlers.generate_nonce", return_value="test-nonce-w1")


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
    relayer.submit_inference.return_value = SubmitResult(
        task_id="task-xyz", ok=True, http_status=201,
    )
    relayer.kv_get = AsyncMock(return_value=None)
    relayer.kv_set = AsyncMock()

    return {
        "bot": mock_bot,
        "wallet_mgr": wallet_mgr,
        "payment_mgr": payment_mgr,
        "relayer": relayer,
    }


def _payment_complete_payload(on_chain_task_id=42, prompt="Hello AI"):
    return {
        "action": "payment_complete",
        "on_chain_task_id": on_chain_task_id,
        "prompt": prompt,
        "tier": "small",
        "chat_id": 67890,
        "message_id": 100,
        "starknet_address": "0x" + "ab" * 32,
    }


# ---------------------------------------------------------------------------
# SubmitResult model
# ---------------------------------------------------------------------------

class TestSubmitResult:
    """SubmitResult carries structured error info from relayer."""

    def test_ok_result(self):
        r = SubmitResult(task_id="abc123", ok=True, http_status=201)
        assert r.ok is True
        assert r.task_id == "abc123"
        assert r.error_code is None

    def test_402_result(self):
        r = SubmitResult(ok=False, http_status=402, error_code="payment_required",
                         error_detail="payment not found")
        assert r.ok is False
        assert r.error_code == "payment_required"

    def test_502_result(self):
        r = SubmitResult(ok=False, http_status=502, error_code="bad_gateway",
                         error_detail="upstream down")
        assert r.ok is False
        assert r.error_code == "bad_gateway"

    def test_network_error_result(self):
        r = SubmitResult(ok=False, error_code="network_error",
                         error_detail="Connection refused")
        assert r.ok is False
        assert r.http_status is None


# ---------------------------------------------------------------------------
# Relayer 402 / 502 handling in webapp payment_complete
# ---------------------------------------------------------------------------

class TestRelayerErrorHandling:
    """Relayer errors must produce user-friendly messages, not generic failures."""

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_relayer_402_shows_payment_message(self, mock_settings, mock_pv_cls, deps):
        """402 from relayer → specific payment-related message to user."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv

        deps["relayer"].submit_inference.return_value = SubmitResult(
            ok=False, http_status=402, error_code="payment_required",
            error_detail="Escrow not funded",
        )

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        edit_call = deps["bot"].edit_message_text.call_args
        assert "payment" in edit_call[1]["text"].lower() or "verify" in edit_call[1]["text"].lower()

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_relayer_502_shows_retry_message(self, mock_settings, mock_pv_cls, deps):
        """502 from relayer → message about compute nodes being unreachable."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv

        deps["relayer"].submit_inference.return_value = SubmitResult(
            ok=False, http_status=502, error_code="bad_gateway",
            error_detail="Compute provider temporarily unreachable",
        )

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        edit_call = deps["bot"].edit_message_text.call_args
        text = edit_call[1]["text"].lower()
        assert "unreachable" in text or "try again" in text

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_relayer_generic_error_fallback(self, mock_settings, mock_pv_cls, deps):
        """Unknown relayer error → generic but clear message."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv

        deps["relayer"].submit_inference.return_value = SubmitResult(
            ok=False, http_status=500, error_code="rejected",
            error_detail="Internal Server Error",
        )

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        edit_call = deps["bot"].edit_message_text.call_args
        assert "failed" in edit_call[1]["text"].lower() or "try again" in edit_call[1]["text"].lower()


# ---------------------------------------------------------------------------
# Delayed verification
# ---------------------------------------------------------------------------

class TestDelayedVerification:
    """On-chain verification may be delayed — bot should retry before failing."""

    @pytest.mark.asyncio
    @patch("src.handlers.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_delayed_verification_retries_then_succeeds(
        self, mock_settings, mock_pv_cls, mock_sleep, deps,
    ):
        """If first verify returns 'not found', retry should succeed."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        # First call: not found (tx still propagating). Second: success.
        mock_pv.verify_escrow.side_effect = [
            (False, "Task not found on-chain"),
            (True, None),
        ]
        mock_pv_cls.return_value = mock_pv

        deps["relayer"].submit_inference.return_value = SubmitResult(
            task_id="task-delayed-ok", ok=True, http_status=201,
        )

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        # Verify retry happened
        assert mock_pv.verify_escrow.call_count == 2
        assert mock_sleep.call_count == 1
        # Task was submitted successfully
        deps["relayer"].submit_inference.assert_called_once()

    @pytest.mark.asyncio
    @patch("src.handlers.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_delayed_verification_retries_then_fails_closed(
        self, mock_settings, mock_pv_cls, mock_sleep, deps,
    ):
        """If all retries return 'not found', must fail closed."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        # All attempts fail with "not found"
        mock_pv.verify_escrow.return_value = (False, "Task not found on-chain")
        mock_pv_cls.return_value = mock_pv

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        # 1 initial + 2 retries = 3 total calls
        assert mock_pv.verify_escrow.call_count == 3
        # Task must NOT be submitted
        deps["relayer"].submit_inference.assert_not_called()
        # User gets a helpful message
        send_call = deps["bot"].send_message.call_args
        text = send_call[1]["text"].lower()
        assert "verification failed" in text or "confirming" in text

    @pytest.mark.asyncio
    @patch("src.handlers.asyncio.sleep", new_callable=AsyncMock)
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_non_notfound_error_no_retry(
        self, mock_settings, mock_pv_cls, mock_sleep, deps,
    ):
        """Verification errors other than 'not found' should fail immediately."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (False, "Wallet address does not match")
        mock_pv_cls.return_value = mock_pv

        update = _make_webapp_update(_payment_complete_payload())
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        # Only 1 call, no retries for address mismatch
        assert mock_pv.verify_escrow.call_count == 1
        mock_sleep.assert_not_called()
        deps["relayer"].submit_inference.assert_not_called()


# ---------------------------------------------------------------------------
# Happy path — full direct flow
# ---------------------------------------------------------------------------

class TestDirectFlowHappyPath:
    """Complete happy path: prompt → pay gate → approval → verification → submit → result."""

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_happy_path_end_to_end(self, mock_settings, mock_pv_cls, deps):
        """Full flow: payment_complete → escrow verified → task submitted."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv

        deps["relayer"].submit_inference.return_value = SubmitResult(
            task_id="task-happy", ok=True, http_status=201,
        )

        update = _make_webapp_update(_payment_complete_payload(on_chain_task_id=99))
        await handle_webapp_data(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        # Escrow was verified
        mock_pv.verify_escrow.assert_called_once_with(
            on_chain_task_id=99,
            expected_address="0x" + "ab" * 32,
        )
        # Task was submitted
        deps["relayer"].submit_inference.assert_called_once()
        call_args = deps["relayer"].submit_inference.call_args
        assert call_args[1]["on_chain_task_id"] == 99
        # Payment was reserved
        deps["payment_mgr"].reserve_payment.assert_called_once()
        # Message was updated with task ID
        edit_call = deps["bot"].edit_message_text.call_args
        assert "task-hap" in edit_call[1]["text"].lower()


# ---------------------------------------------------------------------------
# Audit metrics
# ---------------------------------------------------------------------------

class TestAuditMetrics:
    """Structured metric logs must appear at each pipeline stage."""

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_flow_selected_metric(self, mock_settings, deps, caplog):
        """metric.flow-selected logged when inference handler runs."""
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = "https://smainer-miniapp.vercel.app/?flow=direct"
        mock_settings.telemetry_sensitive_fields = False

        with caplog.at_level(logging.INFO, logger="src.handlers"):
            update = _make_update("Test prompt")
            await handle_inference(
                update, deps["bot"], deps["wallet_mgr"],
                deps["payment_mgr"], deps["relayer"],
            )

        assert any("metric.flow-selected" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_approval_complete_metric(self, mock_settings, mock_pv_cls, deps, caplog):
        """metric.approval-complete logged when payment_complete action received."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv
        deps["relayer"].submit_inference.return_value = SubmitResult(
            task_id="task-m", ok=True, http_status=201,
        )

        with caplog.at_level(logging.INFO, logger="src.handlers"):
            update = _make_webapp_update(_payment_complete_payload())
            await handle_webapp_data(
                update, deps["bot"], deps["wallet_mgr"],
                deps["payment_mgr"], deps["relayer"],
            )

        assert any("metric.approval-complete" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_compute_submitted_metric(self, mock_settings, mock_pv_cls, deps, caplog):
        """metric.compute-submitted logged when relayer accepts task."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (True, None)
        mock_pv_cls.return_value = mock_pv
        deps["relayer"].submit_inference.return_value = SubmitResult(
            task_id="task-cs", ok=True, http_status=201,
        )

        with caplog.at_level(logging.INFO, logger="src.handlers"):
            update = _make_webapp_update(_payment_complete_payload())
            await handle_webapp_data(
                update, deps["bot"], deps["wallet_mgr"],
                deps["payment_mgr"], deps["relayer"],
            )

        assert any("metric.compute-submitted" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    @patch("src.handlers.PaymentVerifier")
    @patch("src.handlers.settings")
    async def test_verification_failed_metric(self, mock_settings, mock_pv_cls, deps, caplog):
        """metric.verification-failed logged when escrow check rejects."""
        mock_settings.telemetry_sensitive_fields = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000

        mock_pv = AsyncMock()
        mock_pv.verify_escrow.return_value = (False, "Wallet address does not match")
        mock_pv_cls.return_value = mock_pv

        with caplog.at_level(logging.WARNING, logger="src.handlers"):
            update = _make_webapp_update(_payment_complete_payload())
            await handle_webapp_data(
                update, deps["bot"], deps["wallet_mgr"],
                deps["payment_mgr"], deps["relayer"],
            )

        assert any("metric.verification-failed" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Feature-flag rollback (no regression from Wave 0)
# ---------------------------------------------------------------------------

class TestFeatureFlagRollback:
    """Feature flag toggle must still work after Wave 1 changes."""

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flag_on_uses_url_button(self, mock_settings, deps):
        mock_settings.wallet_flow_direct = True
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_direct_pay_url.return_value = "https://smainer-miniapp.vercel.app/?flow=direct"
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("Hello AI")
        await handle_inference(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        button = call_kwargs["reply_markup"].inline_keyboard[0][0]
        assert button.url is not None
        assert button.web_app is None

    @pytest.mark.asyncio
    @patch("src.handlers.settings")
    async def test_direct_flag_off_uses_webapp_button(self, mock_settings, deps):
        mock_settings.wallet_flow_direct = False
        mock_settings.default_model = "llama3.1:8b"
        mock_settings.prompt_cost_strk = 100_000_000_000_000_000
        mock_settings.miniapp_url = "https://smainer-miniapp.vercel.app"
        mock_settings.get_miniapp_pay_url.return_value = "https://smainer-miniapp.vercel.app/?action=pay"
        mock_settings.telemetry_sensitive_fields = False

        update = _make_update("Hello AI")
        await handle_inference(
            update, deps["bot"], deps["wallet_mgr"],
            deps["payment_mgr"], deps["relayer"],
        )

        call_kwargs = deps["bot"].edit_message_reply_markup.call_args[1]
        button = call_kwargs["reply_markup"].inline_keyboard[0][0]
        assert button.web_app is not None
        assert button.url is None
