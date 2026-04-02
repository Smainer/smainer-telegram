"""Tests for api/callback/complete.py.

These are Vercel serverless callback handlers. Tests exercise the internal
async functions with mocked Telegram Bot.
"""

import json
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.models import TaskCallback


# ---------------------------------------------------------------------------
# Complete callback — _handle_task_complete
# ---------------------------------------------------------------------------


class TestHandleTaskComplete:
    """Tests for api.callback.complete._handle_task_complete."""

    @pytest.mark.asyncio
    async def test_completed_task_edits_message(self):
        callback = TaskCallback(
            task_id="task-1",
            status="completed",
            result={"response": "AI output here"},
            execution_time=2.5,
            chat_id=67890,
            message_id=999,
        )

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.Bot", return_value=mock_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, 67890, 999)

        mock_bot.edit_message_text.assert_called()
        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert call_kwargs["chat_id"] == 67890
        assert call_kwargs["message_id"] == 999
        assert "2.5s" in call_kwargs["text"]

    @pytest.mark.asyncio
    async def test_failed_task_shows_error(self):
        callback = TaskCallback(
            task_id="task-2",
            status="failed",
            error="GPU OOM",
            chat_id=67890,
            message_id=999,
        )

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.Bot", return_value=mock_bot):
            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback, 67890, 999)

        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert "GPU OOM" in call_kwargs["text"]


# ---------------------------------------------------------------------------
# HTTP handler classes (verify signature flow)
# ---------------------------------------------------------------------------


class TestCompleteHTTPHandler:
    """Test the complete.handler BaseHTTPRequestHandler's do_POST."""

    def test_invalid_signature_returns_401(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        h.headers = {
            "Content-Length": "10",
            "X-Smainer-Signature": "bad-sig",
            "X-Smainer-Timestamp": str(int(time.time())),
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = b'{"test":1}'
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()

        with patch("api.callback.complete.verify_callback_signature", return_value=False):
            h.do_POST()

        h.send_response.assert_called_with(401)

    def test_valid_completion_returns_200(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        body = json.dumps({
            "task_id": "t1", "status": "completed",
            "result": {"response": "hi"}, "execution_time": 1.0,
            "chat_id": 67890, "message_id": 999,
        }).encode()
        h.headers = {
            "Content-Length": str(len(body)),
            "X-Smainer-Signature": "sig",
            "X-Smainer-Timestamp": "123",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = body
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.send_header = MagicMock()

        with patch("api.callback.complete.verify_callback_signature", return_value=True), \
             patch("api.callback.complete.asyncio") as mock_asyncio:
            mock_asyncio.run = MagicMock()
            h.do_POST()

        h.send_response.assert_called_with(200)

    def test_missing_routing_fields_returns_400(self):
        from api.callback.complete import handler as CompleteHandler

        h = CompleteHandler.__new__(CompleteHandler)
        body = json.dumps({
            "task_id": "t1", "status": "completed",
            "result": {"response": "hi"}, "execution_time": 1.0,
        }).encode()
        h.headers = {
            "Content-Length": str(len(body)),
            "X-Smainer-Signature": "sig",
            "X-Smainer-Timestamp": "123",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = body
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.send_header = MagicMock()

        with patch("api.callback.complete.verify_callback_signature", return_value=True):
            h.do_POST()

        h.send_response.assert_called_with(400)
