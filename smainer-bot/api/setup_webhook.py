"""Vercel serverless function: GET/POST /api/setup-webhook

Admin endpoint to register/verify the Telegram webhook.
Protected by WEBHOOK_SECRET header check.

GET:  Returns current webhook status
POST: Sets webhook to https://bot.smainer.io/api/webhook
"""

import json
import logging
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from src.config import settings

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"
WEBHOOK_URL = "https://bot.smainer.io/api/webhook"


def _telegram_api(method: str, data: dict | None = None) -> dict:
    """Make a Telegram Bot API call."""
    token = settings.telegram_bot_token
    url = f"{TELEGRAM_API}/bot{token}/{method}"
    
    if data:
        payload = json.dumps(data).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        request = Request(url, data=payload, headers=headers, method="POST")
    else:
        request = Request(url)
    
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _verify_admin(self) -> bool:
        """Verify admin access via X-Admin-Secret header."""
        secret = self.headers.get("X-Admin-Secret", "")
        if not settings.webhook_secret:
            return True  # No secret configured
        return secret == settings.webhook_secret

    def do_GET(self) -> None:
        """Get current webhook status."""
        if not self._verify_admin():
            self._send_json(401, {"error": "Unauthorized"})
            return

        try:
            result = _telegram_api("getWebhookInfo")
            info = result.get("result", {})
            
            current_url = info.get("url", "")
            is_correct = current_url == WEBHOOK_URL
            
            self._send_json(200, {
                "status": "ok" if is_correct else "misconfigured",
                "webhook_url": current_url,
                "expected_url": WEBHOOK_URL,
                "pending_updates": info.get("pending_update_count", 0),
                "last_error": info.get("last_error_message"),
                "last_error_date": info.get("last_error_date"),
            })
        except (URLError, HTTPError) as e:
            logger.error("Failed to get webhook info: %s", e)
            self._send_json(500, {"error": str(e)})

    def do_POST(self) -> None:
        """Set webhook to the correct URL."""
        if not self._verify_admin():
            self._send_json(401, {"error": "Unauthorized"})
            return

        try:
            data = {
                "url": WEBHOOK_URL,
                "allowed_updates": ["message", "callback_query"],
                "drop_pending_updates": False,
            }
            
            if settings.webhook_secret:
                data["secret_token"] = settings.webhook_secret
            
            result = _telegram_api("setWebhook", data)
            
            if result.get("ok"):
                # Verify it was set
                info = _telegram_api("getWebhookInfo").get("result", {})
                self._send_json(200, {
                    "status": "webhook_set",
                    "webhook_url": WEBHOOK_URL,
                    "pending_updates": info.get("pending_update_count", 0),
                })
            else:
                self._send_json(500, {
                    "error": "Failed to set webhook",
                    "details": result,
                })
        except (URLError, HTTPError) as e:
            logger.error("Failed to set webhook: %s", e)
            self._send_json(500, {"error": str(e)})
