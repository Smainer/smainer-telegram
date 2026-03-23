"""Vercel serverless function: POST /api/webhook

Entry point for all Telegram Bot API updates delivered via webhook.

Security: every incoming request is verified against the X-Telegram-Bot-Api-Secret-Token
header using the WEBHOOK_SECRET configured in Vercel env vars.

Uses python-telegram-bot Bot directly (not Application.process_update) for
maximum control in serverless context.
"""

import asyncio
import hmac
import json
import logging
from http.server import BaseHTTPRequestHandler

import redis.asyncio as aioredis
from telegram import Bot

from src.config import settings
from src.handlers import (
    handle_balance,
    handle_help,
    handle_inference,
    handle_link,
    handle_models,
    handle_set_model,
    handle_start,
    handle_unlink,
    handle_webapp_data,
)
from src.payment import PaymentManager
from src.relayer_client import RelayerClient
from src.wallet import WalletManager

logger = logging.getLogger(__name__)


def _verify_webhook_secret(secret_header: str | None) -> bool:
    """Verify the Telegram webhook secret token.

    Telegram sends X-Telegram-Bot-Api-Secret-Token with every update when a
    secret_token was set during setWebhook. We compare using hmac.compare_digest
    to avoid timing attacks.
    """
    if not settings.webhook_secret:
        # No secret configured — skip verification (dev only)
        logger.warning("WEBHOOK_SECRET not set — skipping signature verification")
        return True
    if not secret_header:
        return False
    return hmac.compare_digest(
        secret_header.encode("utf-8"),
        settings.webhook_secret.encode("utf-8"),
    )


async def _process_update(update: dict) -> None:
    """Route the Telegram update to the appropriate handler.
    
    Creates Redis connection, Bot instance, and all dependencies per invocation.
    Handlers are responsible for sending responses directly via bot.send_message().
    """
    # Create dependencies for this invocation
    redis_client = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_timeout=10,
        socket_connect_timeout=5,
    )
    
    try:
        bot = Bot(token=settings.telegram_bot_token)
        wallet_mgr = WalletManager(redis_client)
        payment_mgr = PaymentManager(redis_client)
        relayer = RelayerClient(callback_base_url=settings.callback_base_url)
        
        # Determine update type and route
        message = update.get("message", {})
        
        # Check for web_app_data first (special message type)
        if "web_app_data" in message:
            await handle_webapp_data(update, bot, wallet_mgr)
            return
        
        text = message.get("text", "")
        
        if not text:
            # Non-text message (photo, document, etc.) — ignore
            return
        
        # Route commands
        if text.startswith("/start"):
            await handle_start(update, bot, wallet_mgr)
        elif text.startswith("/help"):
            await handle_help(update, bot)
        elif text.startswith("/link"):
            await handle_link(update, bot, wallet_mgr)
        elif text.startswith("/unlink"):
            await handle_unlink(update, bot, wallet_mgr)
        elif text.startswith("/balance"):
            await handle_balance(update, bot, wallet_mgr)
        elif text.startswith("/models"):
            await handle_models(update, bot, relayer)
        elif text.startswith("/model"):
            await handle_set_model(update, bot, redis_client)
        elif not text.startswith("/"):
            # Any plain text that isn't a command → treat as inference request
            await handle_inference(
                update,
                bot,
                redis_client,
                wallet_mgr,
                payment_mgr,
                relayer,
            )
        else:
            # Unknown command — send help hint
            chat_id = message.get("chat", {}).get("id")
            if chat_id:
                await bot.send_message(
                    chat_id=chat_id,
                    text="Unknown command. Try /help for available commands.",
                )
    finally:
        await redis_client.aclose()


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/webhook."""

    def do_POST(self) -> None:  # noqa: N802  (Vercel requires this exact name)
        # ------------------------------------------------------------------
        # 1. Verify Telegram webhook secret
        # ------------------------------------------------------------------
        secret_header = self.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if not _verify_webhook_secret(secret_header):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return

        # ------------------------------------------------------------------
        # 2. Parse request body
        # ------------------------------------------------------------------
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)
        try:
            update = json.loads(raw_body)
        except (json.JSONDecodeError, ValueError):
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_json"}')
            return

        # ------------------------------------------------------------------
        # 3. Process the update asynchronously
        # ------------------------------------------------------------------
        try:
            asyncio.run(_process_update(update))
        except Exception as exc:
            logger.exception("Unhandled error processing update: %s", exc)
            # Always return 200 to Telegram — otherwise it will retry indefinitely

        # Always return 200 to Telegram
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        """Suppress default BaseHTTPRequestHandler access log spam."""
        logger.debug(format, *args)
