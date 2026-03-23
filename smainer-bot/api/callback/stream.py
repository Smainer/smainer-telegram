"""Vercel serverless function: POST /api/callback/stream

Receives streaming inference chunks pushed by the Relayer to this bot.
The Relayer posts here for every partial response chunk during generation.

Security: HMAC-SHA256 signature verification via shared callback_auth module.
"""

import asyncio
import json
import logging
import time
from http.server import BaseHTTPRequestHandler

import redis.asyncio as aioredis
from telegram import Bot
from telegram.error import TelegramError

from src.callback_auth import verify_callback_signature
from src.config import settings
from src.handlers import PENDING_TASKS_KEY
from src.models import StreamChunk

logger = logging.getLogger(__name__)

# Rate limit: minimum seconds between message edits per task
MIN_EDIT_INTERVAL = 0.5

# Redis keys for stream state
STREAM_LAST_EDIT_KEY = "tgbot:stream:last_edit:{task_id}"
STREAM_TEXT_KEY = "tgbot:stream:text:{task_id}"


async def _handle_stream_chunk(chunk: StreamChunk) -> None:
    """Process a streaming chunk: accumulate text, rate-limit message edits."""
    redis_client = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
    )

    try:
        raw_loc = await redis_client.hget(PENDING_TASKS_KEY, chunk.task_id)
        if not raw_loc:
            logger.debug("Task not found for stream chunk", extra={"task_id": chunk.task_id})
            return

        chat_id, message_id = map(int, raw_loc.split(":"))

        # Accumulate text in Redis
        text_key = STREAM_TEXT_KEY.format(task_id=chunk.task_id)
        await redis_client.append(text_key, chunk.chunk)
        await redis_client.expire(text_key, 3600)
        accumulated_text = await redis_client.get(text_key) or ""

        # Rate-limit edits
        last_edit_key = STREAM_LAST_EDIT_KEY.format(task_id=chunk.task_id)
        last_edit_str = await redis_client.get(last_edit_key)
        now = time.time()

        should_edit = chunk.done  # Always edit on final chunk
        if not should_edit and not last_edit_str:
            should_edit = True  # First chunk — edit immediately
        elif not should_edit and last_edit_str:
            should_edit = (now - float(last_edit_str)) >= MIN_EDIT_INTERVAL

        if not should_edit:
            return

        await redis_client.setex(last_edit_key, 3600, str(now))

        # Edit Telegram message
        bot = Bot(token=settings.telegram_bot_token)
        display_text = accumulated_text[:4000]
        if not display_text.strip():
            display_text = "Processing..."
        if not chunk.done:
            display_text += " ▌"

        try:
            await bot.edit_message_text(
                chat_id=chat_id, message_id=message_id, text=display_text
            )
        except TelegramError as e:
            logger.debug(f"Stream edit failed: {e}")

        # Clean up on final chunk
        if chunk.done:
            await redis_client.delete(text_key, last_edit_key)
            logger.info("Stream completed", extra={"task_id": chunk.task_id, "chars": len(accumulated_text)})
    except aioredis.RedisError as e:
        logger.error(f"Redis error in stream handler: {e}", extra={"task_id": chunk.task_id})
        raise  # Will cause 500 response so Relayer retries
    finally:
        await redis_client.aclose()


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/callback/stream."""

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        # 1. Verify HMAC signature
        sig_header = self.headers.get("X-Smainer-Signature")
        timestamp = self.headers.get("X-Smainer-Timestamp")

        if not verify_callback_signature(raw_body, timestamp, sig_header):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_signature"}')
            return

        # 2. Parse StreamChunk
        try:
            chunk = StreamChunk.model_validate_json(raw_body)
        except Exception as exc:
            logger.warning("Failed to parse StreamChunk: %s", exc)
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_payload"}')
            return

        # 3. Forward chunk to Telegram message
        try:
            asyncio.run(_handle_stream_chunk(chunk))
        except aioredis.RedisError:
            # Redis failure — return 500 so Relayer can retry
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"internal_error"}')
            return
        except Exception as exc:
            logger.exception("Error handling stream chunk: %s", exc)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
