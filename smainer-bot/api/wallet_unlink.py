"""Vercel serverless function: POST /api/wallet-unlink

Unlinks the Starknet wallet for a Telegram user, verifying the request
via Telegram initData signature before touching the relayer KV store.

Called by the MiniApp when the user taps "Disconnect & Unlink".

Response:
    200: {"unlinked": true}
    200: {"unlinked": false}  — no wallet was linked
    400: Missing or malformed initData
    401: Signature verification failed
    500: Internal error
"""

import hashlib
import hmac
import json
import logging
import urllib.parse
from http.server import BaseHTTPRequestHandler

import httpx

from src.config import settings

logger = logging.getLogger(__name__)


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict | None:
    """Verify Telegram WebApp initData signature.

    Returns parsed data dict if valid, None if invalid.
    """
    try:
        parsed = urllib.parse.parse_qs(init_data, keep_blank_values=True)

        received_hash = parsed.get("hash", [""])[0]
        if not received_hash:
            return None

        data_pairs = [
            f"{key}={values[0]}"
            for key, values in parsed.items()
            if key != "hash"
        ]
        data_pairs.sort()
        data_check_string = "\n".join(data_pairs)

        secret_key = hmac.new(
            b"WebAppData",
            bot_token.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        expected_hash = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(received_hash, expected_hash):
            logger.warning("initData signature mismatch")
            return None

        user_data = parsed.get("user", [""])[0]
        if user_data:
            try:
                user = json.loads(user_data)
                return {"user": user, "auth_date": parsed.get("auth_date", [""])[0]}
            except json.JSONDecodeError:
                pass

        return {"auth_date": parsed.get("auth_date", [""])[0]}

    except Exception as e:
        logger.error(f"Error verifying initData: {e}")
        return None


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/wallet-unlink."""

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        try:
            body = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            self._send_json_response(400, {"error": "invalid_json"})
            return

        init_data = body.get("initData", "")

        if not init_data:
            self._send_json_response(400, {"error": "missing_init_data"})
            return

        verified = verify_telegram_init_data(init_data, settings.telegram_bot_token)
        if not verified:
            self._send_json_response(401, {"error": "invalid_signature"})
            return

        user = verified.get("user", {})
        user_id = user.get("id")

        if not user_id:
            self._send_json_response(400, {"error": "missing_user_id"})
            return

        try:
            unlinked = self._delete_linked_wallet(user_id)
            self._send_json_response(200, {"unlinked": unlinked})
        except Exception as e:
            logger.exception(f"Error unlinking wallet: {e}")
            self._send_json_response(500, {"error": "internal_error"})

    def _delete_linked_wallet(self, user_id: int) -> bool:
        """Delete wallet link from relayer KV. Returns True if a link existed."""
        base = settings.relayer_api_url.rstrip("/")
        headers = {
            "Authorization": f"Bearer {settings.relayer_api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = httpx.delete(
                f"{base}/api/v1/bot/kv/wallet:{user_id}",
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True
        except Exception as e:
            logger.warning(f"KV delete error: {e}")
            raise

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json_response(self, status: int, data: dict) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
