"""Security tests for relayer callback authentication."""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock

import pytest

from telegram_bot.callback_server import CallbackServer


def _signed_headers(secret: str, timestamp: int, body: bytes) -> dict[str, str]:
    signature = hmac.new(
        secret.encode("utf-8"),
        str(timestamp).encode("utf-8") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Smainer-Timestamp": str(timestamp),
        "X-Smainer-Signature": signature,
    }


class TestCallbackServerAuthentication:
    @pytest.mark.asyncio
    async def test_complete_callback_requires_valid_signature(self, monkeypatch):
        monkeypatch.setattr("telegram_bot.callback_server.time.time", lambda: 1_700_000_000)

        server = CallbackServer(port=8100, signing_secret="test-api-key")
        handler = AsyncMock()
        server.on_task_complete(handler)

        body = json.dumps(
            {"task_id": "task-1", "status": "completed", "result": {"response": "ok"}},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        request = AsyncMock()
        request.read.return_value = body
        request.headers = _signed_headers("test-api-key", 1_700_000_000, body)

        response = await server._handle_complete(request)

        assert response.status == 200
        handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_callback_rejects_missing_signature(self):
        server = CallbackServer(port=8100, signing_secret="test-api-key")
        handler = AsyncMock()
        server.on_stream_chunk(handler)

        request = AsyncMock()
        request.read.return_value = b'{"task_id":"task-1","chunk":"hello","done":false}'
        request.headers = {}

        response = await server._handle_stream(request)

        assert response.status == 401
        handler.assert_not_called()

    @pytest.mark.asyncio
    async def test_complete_callback_rejects_stale_timestamp(self, monkeypatch):
        monkeypatch.setattr("telegram_bot.callback_server.time.time", lambda: 1_700_000_000)

        server = CallbackServer(port=8100, signing_secret="test-api-key")
        handler = AsyncMock()
        server.on_task_complete(handler)

        body = json.dumps(
            {"task_id": "task-1", "status": "failed", "error": "boom"},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        request = AsyncMock()
        request.read.return_value = body
        request.headers = _signed_headers("test-api-key", 1_699_999_000, body)

        response = await server._handle_complete(request)

        assert response.status == 401
        handler.assert_not_called()