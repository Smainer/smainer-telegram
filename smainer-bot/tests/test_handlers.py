"""Tests for src/handlers.py — Telegram command handler functions."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.handlers import (
    escape_md,
    infer_tier,
    handle_start,
    handle_help,
    handle_link,
    handle_unlink,
    handle_balance,
    handle_models,
    handle_set_model,
    handle_inference,
    handle_webapp_data,
)
from src.models import ModelTier
from src.wallet import BalanceUnavailableError, WalletManager
from src.payment import PaymentManager
from src.relayer_client import RelayerClient


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


class TestEscapeMd:
    def test_underscores(self):
        assert escape_md("hello_world") == "hello\\_world"

    def test_asterisks(self):
        assert escape_md("*bold*") == "\\*bold\\*"

    def test_backticks(self):
        assert escape_md("`code`") == "\\`code\\`"

    def test_no_special_chars(self):
        assert escape_md("plain text") == "plain text"

    def test_combined(self):
        assert escape_md("_*`mix`*_") == "\\_\\*\\`mix\\`\\*\\_"


class TestInferTier:
    def test_small_models(self):
        assert infer_tier("llama3.1:8b") == ModelTier.SMALL
        assert infer_tier("mistral:7b") == ModelTier.SMALL

    def test_medium_models(self):
        assert infer_tier("llama3.1:13b") == ModelTier.MEDIUM
        assert infer_tier("codellama:34b") == ModelTier.MEDIUM
        assert infer_tier("yi:14b") == ModelTier.MEDIUM

    def test_large_models(self):
        assert infer_tier("llama3.1:70b") == ModelTier.LARGE
        assert infer_tier("qwen:72b") == ModelTier.LARGE
        assert infer_tier("llama:65b") == ModelTier.LARGE

    def test_unknown_defaults_to_small(self):
        assert infer_tier("custom-model") == ModelTier.SMALL


# ---------------------------------------------------------------------------
# Helpers for building Telegram updates
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


# ---------------------------------------------------------------------------
# /start
# ---------------------------------------------------------------------------


class TestHandleStart:
    @pytest.mark.asyncio
    async def test_start_no_payload_sends_welcome(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        update = _make_update("/start")

        await handle_start(update, mock_bot, wallet_mgr)

        mock_bot.send_message.assert_called_once()
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Welcome to Smainer" in text

    @pytest.mark.asyncio
    async def test_start_with_link_payload(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        addr = "0x" + "ab" * 32
        update = _make_update(f"/start link_{addr}")

        await handle_start(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_called_once_with(12345, addr)
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Wallet connected" in text

    @pytest.mark.asyncio
    async def test_start_with_invalid_link_payload(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.link_wallet.side_effect = ValueError("bad address")
        update = _make_update("/start link_0xINVALID")

        await handle_start(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "Invalid" in text

    @pytest.mark.asyncio
    async def test_start_with_base64_payload(self, mock_bot):
        import base64
        addr_bytes = bytes.fromhex("04a3ff")
        encoded = base64.urlsafe_b64encode(addr_bytes).decode().rstrip("=")
        wallet_mgr = AsyncMock(spec=WalletManager)
        update = _make_update(f"/start linkb_{encoded}")

        await handle_start(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_called_once()


# ---------------------------------------------------------------------------
# /help
# ---------------------------------------------------------------------------


class TestHandleHelp:
    @pytest.mark.asyncio
    async def test_help_shows_commands(self, mock_bot):
        update = _make_update("/help")

        await handle_help(update, mock_bot)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "/link" in text
        assert "/balance" in text
        assert "/models" in text


# ---------------------------------------------------------------------------
# /link
# ---------------------------------------------------------------------------


class TestHandleLink:
    @pytest.mark.asyncio
    async def test_link_with_address(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        addr = "0x" + "ab" * 32
        update = _make_update(f"/link {addr}")

        await handle_link(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_called_once_with(12345, addr)
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Wallet linked" in text

    @pytest.mark.asyncio
    async def test_link_no_address(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        update = _make_update("/link")

        await handle_link(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_not_called()
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Usage" in text

    @pytest.mark.asyncio
    async def test_link_invalid_address(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.link_wallet.side_effect = ValueError("bad")
        update = _make_update("/link 0xBADBAD")

        await handle_link(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "Invalid" in text


# ---------------------------------------------------------------------------
# /unlink
# ---------------------------------------------------------------------------


class TestHandleUnlink:
    @pytest.mark.asyncio
    async def test_unlink(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        update = _make_update("/unlink")

        await handle_unlink(update, mock_bot, wallet_mgr)

        wallet_mgr.unlink_wallet.assert_called_once_with(12345)
        text = mock_bot.send_message.call_args[1]["text"]
        assert "unlinked" in text.lower()


# ---------------------------------------------------------------------------
# /balance
# ---------------------------------------------------------------------------


class TestHandleBalance:
    @pytest.mark.asyncio
    async def test_balance_no_wallet(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address.return_value = None
        update = _make_update("/balance")

        await handle_balance(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "No wallet linked" in text

    @pytest.mark.asyncio
    async def test_balance_success(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address.return_value = "0x04a3"
        wallet_mgr.get_strk_balance.return_value = 5_000_000_000_000_000_000

        update = _make_update("/balance")

        await handle_balance(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "5.0000" in text
        assert "STRK" in text

    @pytest.mark.asyncio
    async def test_balance_rpc_unavailable(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.get_linked_address.return_value = "0x04a3"
        wallet_mgr.get_strk_balance.side_effect = BalanceUnavailableError("down")

        update = _make_update("/balance")

        await handle_balance(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "unavailable" in text.lower()


# ---------------------------------------------------------------------------
# /models
# ---------------------------------------------------------------------------


class TestHandleModels:
    @pytest.mark.asyncio
    async def test_models_with_nodes(self, mock_bot):
        relayer = AsyncMock(spec=RelayerClient)
        relayer.list_available_models.return_value = [
            {
                "node_id": "node-abcdefgh123",
                "gpu": "RTX 4090",
                "ram_gb": 64,
                "supported_tiers": ["small", "medium"],
            }
        ]
        update = _make_update("/models")

        await handle_models(update, mock_bot, relayer)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "node-abc" in text
        assert "RTX 4090" in text

    @pytest.mark.asyncio
    async def test_models_no_nodes_online(self, mock_bot):
        relayer = AsyncMock(spec=RelayerClient)
        relayer.list_available_models.return_value = []
        update = _make_update("/models")

        await handle_models(update, mock_bot, relayer)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "No compute nodes" in text


# ---------------------------------------------------------------------------
# /model <name>
# ---------------------------------------------------------------------------


class TestHandleSetModel:
    @pytest.mark.asyncio
    async def test_set_model(self, mock_bot):
        relayer = AsyncMock(spec=RelayerClient)
        relayer.kv_get = AsyncMock(return_value=None)
        relayer.kv_set = AsyncMock()
        update = _make_update("/model llama3.1:70b")

        await handle_set_model(update, mock_bot, relayer)

        relayer.kv_set.assert_called_once()
        text = mock_bot.send_message.call_args[1]["text"]
        assert "llama3.1:70b" in text

    @pytest.mark.asyncio
    async def test_show_current_model(self, mock_bot):
        relayer = AsyncMock(spec=RelayerClient)
        relayer.kv_get = AsyncMock(return_value="mistral:7b")
        relayer.kv_set = AsyncMock()
        update = _make_update("/model")

        await handle_set_model(update, mock_bot, relayer)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "mistral:7b" in text


# ---------------------------------------------------------------------------
# Inference (text message)
# ---------------------------------------------------------------------------


class TestHandleInference:
    @pytest.fixture
    def deps(self, mock_bot):
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

    @pytest.mark.asyncio
    async def test_inference_success(self, deps):
        update = _make_update("Hello AI, generate something")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["relayer"].submit_inference.assert_called_once()
        deps["payment_mgr"].reserve_payment.assert_called_once()

    @pytest.mark.asyncio
    async def test_inference_no_wallet(self, deps):
        deps["wallet_mgr"].get_linked_address.return_value = None
        update = _make_update("Hello AI")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["relayer"].submit_inference.assert_not_called()
        text = deps["bot"].send_message.call_args[1]["text"]
        assert "wallet" in text.lower()

    @pytest.mark.asyncio
    async def test_inference_insufficient_balance(self, deps):
        deps["wallet_mgr"].has_sufficient_balance.return_value = False
        update = _make_update("Hello AI")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["relayer"].submit_inference.assert_not_called()
        text = deps["bot"].send_message.call_args[1]["text"]
        assert "Insufficient" in text

    @pytest.mark.asyncio
    async def test_inference_empty_message_ignored(self, deps):
        update = _make_update("   ")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["bot"].send_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_inference_no_nodes(self, deps):
        deps["relayer"].list_available_models.return_value = []
        update = _make_update("Hello AI")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        deps["relayer"].submit_inference.assert_not_called()
        text = deps["bot"].send_message.call_args[1]["text"]
        assert "No compute nodes" in text

    @pytest.mark.asyncio
    async def test_inference_relayer_rejected(self, deps):
        deps["relayer"].submit_inference.return_value = None  # Relayer error
        update = _make_update("Hello AI")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        text = deps["bot"].edit_message_text.call_args[1]["text"]
        assert "Failed" in text

    @pytest.mark.asyncio
    async def test_inference_balance_check_fails(self, deps):
        deps["wallet_mgr"].has_sufficient_balance.side_effect = BalanceUnavailableError("down")
        update = _make_update("Hello AI")

        await handle_inference(
            update,
            deps["bot"],
            deps["wallet_mgr"],
            deps["payment_mgr"],
            deps["relayer"],
        )

        text = deps["bot"].send_message.call_args[1]["text"]
        assert "Balance check failed" in text


# ---------------------------------------------------------------------------
# WebApp data (miniapp wallet connect)
# ---------------------------------------------------------------------------


class TestHandleWebappData:
    @pytest.mark.asyncio
    async def test_webapp_wallet_connect(self, mock_bot):
        import json

        wallet_mgr = AsyncMock(spec=WalletManager)
        data = json.dumps({"action": "wallet_connect", "address": "0x04a3", "wallet_type": "argent"})
        update = _make_webapp_update(data)

        await handle_webapp_data(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_called_once_with(12345, "0x04a3")
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Wallet connected" in text

    @pytest.mark.asyncio
    async def test_webapp_invalid_json(self, mock_bot):
        wallet_mgr = AsyncMock(spec=WalletManager)
        update = _make_webapp_update("not-json")

        await handle_webapp_data(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_not_called()
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Failed" in text

    @pytest.mark.asyncio
    async def test_webapp_wrong_action(self, mock_bot):
        import json

        wallet_mgr = AsyncMock(spec=WalletManager)
        data = json.dumps({"action": "something_else"})
        update = _make_webapp_update(data)

        await handle_webapp_data(update, mock_bot, wallet_mgr)

        wallet_mgr.link_wallet.assert_not_called()
        text = mock_bot.send_message.call_args[1]["text"]
        assert "Unexpected" in text

    @pytest.mark.asyncio
    async def test_webapp_invalid_address(self, mock_bot):
        import json

        wallet_mgr = AsyncMock(spec=WalletManager)
        wallet_mgr.link_wallet.side_effect = ValueError("bad")
        data = json.dumps({"action": "wallet_connect", "address": "0xBAD"})
        update = _make_webapp_update(data)

        await handle_webapp_data(update, mock_bot, wallet_mgr)

        text = mock_bot.send_message.call_args[1]["text"]
        assert "Invalid" in text
