"""Tests for src/relayer_client.py — RelayerClient (mocked httpx)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from src.models import InferenceRequest, ModelTier, TaskStatusResponse
from src.relayer_client import RelayerClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return RelayerClient(callback_base_url="https://test-bot.vercel.app")


# ---------------------------------------------------------------------------
# submit_inference
# ---------------------------------------------------------------------------


class TestSubmitInference:
    @pytest.fixture
    def sample_request(self):
        return InferenceRequest(
            telegram_user_id=12345,
            chat_id=67890,
            message_id=111,
            prompt="Hello world",
            model="llama3.1:8b",
            model_tier=ModelTier.SMALL,
            starknet_address="0xabc",
            cost_strk=100_000_000_000_000_000,
        )

    @pytest.mark.asyncio
    async def test_submit_success(self, client, sample_request):
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"task_id": "task-abc-123"}

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.submit_inference(sample_request)

        assert result == "task-abc-123"

    @pytest.mark.asyncio
    async def test_submit_relayer_error(self, client, sample_request):
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.text = "Service Unavailable"

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.submit_inference(sample_request)

        assert result is None

    @pytest.mark.asyncio
    async def test_submit_network_error(self, client, sample_request):
        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(
                side_effect=httpx.RequestError("Connection refused")
            )
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.submit_inference(sample_request)

        assert result is None

    @pytest.mark.asyncio
    async def test_submit_sends_correct_callback_urls(self, client, sample_request):
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"task_id": "t1"}

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.post = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            await client.submit_inference(sample_request)

            call_kwargs = mock_http.post.call_args
            body = call_kwargs[1]["json"]
            assert body["payload"]["stream_callback_url"] == "https://test-bot.vercel.app/api/callback/stream"
            assert body["payload"]["complete_callback_url"] == "https://test-bot.vercel.app/api/callback/complete"


# ---------------------------------------------------------------------------
# get_task_status
# ---------------------------------------------------------------------------


class TestGetTaskStatus:
    @pytest.mark.asyncio
    async def test_get_status_success(self, client):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "task_id": "task-123",
            "status": "completed",
            "result": {"response": "Hello"},
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.get_task_status("task-123")

        assert isinstance(result, TaskStatusResponse)
        assert result.status == "completed"

    @pytest.mark.asyncio
    async def test_get_status_not_found(self, client):
        mock_resp = MagicMock()
        mock_resp.status_code = 404

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.get_task_status("task-missing")

        assert result is None

    @pytest.mark.asyncio
    async def test_get_status_network_error(self, client):
        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(
                side_effect=httpx.RequestError("timeout")
            )
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.get_task_status("task-123")

        assert result is None


# ---------------------------------------------------------------------------
# list_available_models
# ---------------------------------------------------------------------------


class TestListAvailableModels:
    @pytest.mark.asyncio
    async def test_list_models_success(self, client):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "nodes": [
                {
                    "node_id": "node-001",
                    "hardware_spec": {
                        "gpu_info": "NVIDIA RTX 4090",
                        "ram_gb": 64,
                        "gpu_vram_gb": 24,
                        "node_tier": "pro",
                    },
                }
            ]
        }

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.list_available_models()

        assert len(result) >= 1
        assert result[0]["node_id"] == "node-001"
        assert "small" in result[0]["supported_tiers"]

    @pytest.mark.asyncio
    async def test_list_models_no_gpu_nodes_filtered(self, client):
        """Nodes without GPU capability should be filtered out."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "nodes": [
                {
                    "node_id": "cpu-only",
                    "hardware_spec": {
                        "gpu_info": "",
                        "ram_gb": 4,
                        "gpu_vram_gb": 0,
                        "node_tier": "",
                    },
                }
            ]
        }

        # Also mock the fallback endpoint
        mock_fallback = MagicMock()
        mock_fallback.status_code = 200
        mock_fallback.json.return_value = []

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(side_effect=[mock_resp, mock_fallback])
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.list_available_models()

        assert result == []

    @pytest.mark.asyncio
    async def test_list_models_network_error(self, client):
        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(
                side_effect=httpx.RequestError("offline")
            )
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.list_available_models()

        assert result == []

    @pytest.mark.asyncio
    async def test_premium_node_includes_all_tiers(self, client):
        """A premium-tier node with high VRAM should support all model tiers."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "nodes": [
                {
                    "node_id": "premium-001",
                    "hardware_spec": {
                        "gpu_info": "NVIDIA A100",
                        "ram_gb": 128,
                        "gpu_vram_gb": 80,
                        "node_tier": "premium",
                    },
                }
            ]
        }

        with patch("src.relayer_client.httpx.AsyncClient") as MockClient:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_resp)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_http

            result = await client.list_available_models()

        tiers = result[0]["supported_tiers"]
        assert "small" in tiers
        assert "medium" in tiers
        assert "large" in tiers
