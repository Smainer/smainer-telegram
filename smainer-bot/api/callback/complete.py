"""Vercel serverless function: POST /api/callback/complete

Receives the final task completion (or failure) callback from the Relayer.
Called once per task, after all stream chunks have been sent.

Security: HMAC-SHA256 signature verification via shared callback_auth module.
"""

import asyncio
import json
import logging
from http.server import BaseHTTPRequestHandler

import redis.asyncio as aioredis
from telegram import Bot
from telegram.constants import ParseMode

from src.callback_auth import verify_callback_signature
from src.config import settings
from src.handlers import escape_md, PENDING_TASKS_KEY
from src.models import TaskCallback
from src.payment import PaymentManager

logger = logging.getLogger(__name__)


async def _handle_task_complete(callback: TaskCallback) -> None:
    """Process the task completion callback."""
    redis_client = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
    )

    try:
        raw_loc = await redis_client.hget(PENDING_TASKS_KEY, callback.task_id)
        if not raw_loc:
            logger.warning("Task not found in pending tasks", extra={"task_id": callback.task_id})
            return

        chat_id, message_id = map(int, raw_loc.split(":"))
        await redis_client.hdel(PENDING_TASKS_KEY, callback.task_id)

        bot = Bot(token=settings.telegram_bot_token)
        payment_mgr = PaymentManager(redis_client)

        if callback.status == "completed" and callback.result:
            response_text = callback.result.get("response", "No response generated.")
            exec_time = callback.execution_time or 0

            safe_text = escape_md(response_text)
            footer = f"\n\n_Computed in {exec_time:.1f}s_"
            text = safe_text[:3900] + footer

            try:
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id,
                    text=text,
                    parse_mode=ParseMode.MARKDOWN,
                )
            except Exception as e:
                logger.warning(f"Markdown edit failed, trying plain text: {e}")
                await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id,
                    text=response_text[:3900] + f"\n\nComputed in {exec_time:.1f}s",
                )

            await payment_mgr.settle_payment(callback.task_id)
            logger.info("Task completed successfully", extra={"task_id": callback.task_id, "exec_time": exec_time})
        else:
            error = callback.error or "Unknown error occurred"
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=f"Compute failed: {error}",
            )
            await payment_mgr.fail_payment(callback.task_id, error)
            logger.warning("Task failed", extra={"task_id": callback.task_id, "error": error})
    except aioredis.RedisError as e:
        logger.error(f"Redis error in complete handler: {e}", extra={"task_id": callback.task_id})
        raise  # Will cause 500 response so Relayer retries
    finally:
        await redis_client.aclose()


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/callback/complete."""

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        sig_header = self.headers.get("X-Smainer-Signature")
        timestamp = self.headers.get("X-Smainer-Timestamp")

        if not verify_callback_signature(raw_body, timestamp, sig_header):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_signature"}')
            return

        try:
            callback = TaskCallback.model_validate_json(raw_body)
        except Exception as exc:
            logger.warning("Failed to parse TaskCallback: %s", exc)
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_payload"}')
            return

        try:
            asyncio.run(_handle_task_complete(callback))
        except aioredis.RedisError:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"internal_error"}')
            return
        except Exception as exc:
            logger.exception("Error handling task completion: %s", exc)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
