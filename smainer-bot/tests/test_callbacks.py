"""Tests for api/callback/stream.py and api/callback/complete.py.

These are Vercel serverless callback handlers. Tests exercise the internal
async functions with mocked Redis and Telegram Bot.
"""

import json
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.models import StreamChunk, TaskCallback


# ---------------------------------------------------------------------------
# Stream callback — _handle_stream_chunk
# ---------------------------------------------------------------------------


class TestHandleStreamChunk:
    """Tests for api.callback.stream._handle_stream_chunk."""

    @pytest.mark.asyncio
    async def test_first_chunk_edits_message(self):
        chunk = StreamChunk(task_id="task-1", chunk="Hello ", done=False)

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.append = AsyncMock()
        mock_redis.expire = AsyncMock()
        mock_redis.get = AsyncMock(return_value="Hello ")
        mock_redis.setex = AsyncMock()
        mock_redis.delete = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.stream.aioredis") as mock_aioredis, \
             patch("api.callback.stream.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis
            # First chunk — no last edit timestamp
            mock_redis.get.side_effect = ["Hello ", None]

            from api.callback.stream import _handle_stream_chunk
            await _handle_stream_chunk(chunk)

        mock_bot.edit_message_text.assert_called_once()
        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert call_kwargs["chat_id"] == 67890
        assert call_kwargs["message_id"] == 999
        assert "Hello " in call_kwargs["text"]
        assert "▌" in call_kwargs["text"]  # cursor indicator

    @pytest.mark.asyncio
    async def test_final_chunk_no_cursor(self):
        chunk = StreamChunk(task_id="task-1", chunk="!", done=True)

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.append = AsyncMock()
        mock_redis.expire = AsyncMock()
        mock_redis.get = AsyncMock(side_effect=["Hello world!", "123.0"])
        mock_redis.setex = AsyncMock()
        mock_redis.delete = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.stream.aioredis") as mock_aioredis, \
             patch("api.callback.stream.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.stream import _handle_stream_chunk
            await _handle_stream_chunk(chunk)

        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert "▌" not in call_kwargs["text"]  # No cursor on done

    @pytest.mark.asyncio
    async def test_unknown_task_silently_returns(self):
        chunk = StreamChunk(task_id="unknown-task", chunk="data", done=False)

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value=None)  # task not found
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()

        with patch("api.callback.stream.aioredis") as mock_aioredis, \
             patch("api.callback.stream.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.stream import _handle_stream_chunk
            await _handle_stream_chunk(chunk)

        mock_bot.edit_message_text.assert_not_called()

    @pytest.mark.asyncio
    async def test_rate_limited_chunk_skipped(self):
        """If last edit was too recent, non-final chunk should be skipped."""
        chunk = StreamChunk(task_id="task-1", chunk="more text", done=False)

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.append = AsyncMock()
        mock_redis.expire = AsyncMock()
        # get returns: first call = accumulated text, second = very recent timestamp
        mock_redis.get = AsyncMock(
            side_effect=["Hello more text", str(time.time())]
        )
        mock_redis.setex = AsyncMock()
        mock_redis.delete = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()

        with patch("api.callback.stream.aioredis") as mock_aioredis, \
             patch("api.callback.stream.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.stream import _handle_stream_chunk
            await _handle_stream_chunk(chunk)

        mock_bot.edit_message_text.assert_not_called()


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
        )

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.hdel = AsyncMock()
        mock_redis.hset = AsyncMock()
        mock_redis.exists = AsyncMock(return_value=1)
        mock_redis.expire = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.aioredis") as mock_aioredis, \
             patch("api.callback.complete.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback)

        mock_bot.edit_message_text.assert_called()
        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert call_kwargs["chat_id"] == 67890
        assert "2.5s" in call_kwargs["text"]

        # Payment should be settled
        mock_redis.hset.assert_called()

    @pytest.mark.asyncio
    async def test_failed_task_shows_error(self):
        callback = TaskCallback(
            task_id="task-2",
            status="failed",
            error="GPU OOM",
        )

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.hdel = AsyncMock()
        mock_redis.hset = AsyncMock()
        mock_redis.exists = AsyncMock(return_value=1)
        mock_redis.expire = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.aioredis") as mock_aioredis, \
             patch("api.callback.complete.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback)

        call_kwargs = mock_bot.edit_message_text.call_args[1]
        assert "GPU OOM" in call_kwargs["text"]

    @pytest.mark.asyncio
    async def test_unknown_task_silently_returns(self):
        callback = TaskCallback(task_id="unknown", status="completed")

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value=None)  # not found
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()

        with patch("api.callback.complete.aioredis") as mock_aioredis, \
             patch("api.callback.complete.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback)

        mock_bot.edit_message_text.assert_not_called()

    @pytest.mark.asyncio
    async def test_completed_removes_from_pending(self):
        callback = TaskCallback(
            task_id="task-3",
            status="completed",
            result={"response": "done"},
            execution_time=1.0,
        )

        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value="67890:999")
        mock_redis.hdel = AsyncMock()
        mock_redis.hset = AsyncMock()
        mock_redis.exists = AsyncMock(return_value=1)
        mock_redis.expire = AsyncMock()
        mock_redis.aclose = AsyncMock()

        mock_bot = AsyncMock()
        mock_bot.edit_message_text = AsyncMock()

        with patch("api.callback.complete.aioredis") as mock_aioredis, \
             patch("api.callback.complete.Bot", return_value=mock_bot):
            mock_aioredis.from_url.return_value = mock_redis

            from api.callback.complete import _handle_task_complete
            await _handle_task_complete(callback)

        mock_redis.hdel.assert_called_once_with("tgbot:tasks:pending", "task-3")


# ---------------------------------------------------------------------------
# HTTP handler classes (verify signature flow)
# ---------------------------------------------------------------------------


class TestStreamHTTPHandler:
    """Test the stream.handler BaseHTTPRequestHandler's do_POST."""

    def test_invalid_signature_returns_401(self):
        from api.callback.stream import handler as StreamHandler

        h = StreamHandler.__new__(StreamHandler)
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

        with patch("api.callback.stream.verify_callback_signature", return_value=False):
            h.do_POST()

        h.send_response.assert_called_with(401)

    def test_invalid_json_returns_400(self):
        from api.callback.stream import handler as StreamHandler

        h = StreamHandler.__new__(StreamHandler)
        h.headers = {
            "Content-Length": "11",
            "X-Smainer-Signature": "sig",
            "X-Smainer-Timestamp": "123",
        }
        h.rfile = MagicMock()
        h.rfile.read.return_value = b'not-json!!!'
        h.wfile = MagicMock()
        h.send_response = MagicMock()
        h.end_headers = MagicMock()
        h.send_header = MagicMock()

        with patch("api.callback.stream.verify_callback_signature", return_value=True):
            h.do_POST()

        h.send_response.assert_called_with(400)


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
