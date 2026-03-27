"""Vercel serverless function: POST /api/wallet-link

Links a Starknet wallet address to a Telegram user account.
Called by connect.html after Braavos auto-connect in the dApp browser —
uses initData (passed as URL param through the Braavos deep link) for auth.

Request body (JSON): {"address": "0x...", "init_data": "..."}
Response: 200 {"ok": true} | 400/401/500
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
    """Verify Telegram WebApp initData HMAC-SHA256 signature."""
    try:
        parsed = urllib.parse.parse_qs(init_data, keep_blank_values=True)
        received_hash = parsed.get("hash", [""])[0]
        if not received_hash:
            return None
        data_pairs = []
        for key, values in parsed.items():
            if key != "hash":
                data_pairs.append(f"{key}={values[0]}")
        data_pairs.sort()
        data_check_string = "\n".join(data_pairs)
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        expected_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(received_hash, expected_hash):
            logger.warning("initData signature mismatch in wallet-link")
            return None
        user_data = parsed.get("user", [""])[0]
        if user_data:
            try:
                user = json.loads(user_data)
                return {"user": user}
            except json.JSONDecodeError:
                pass
        return {}
    except Exception as e:
        logger.error(f"initData verify error: {e}")
        return None


def normalize_address(address: str) -> str | None:
    s = address.strip().lower()
    if not s.startswith("0x"):
        return None
    hex_part = s[2:]
    if not all(c in "0123456789abcdef" for c in hex_part):
        return None
    return "0x" + hex_part.zfill(64)


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/wallet-link."""

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length)
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self._json(400, {"error": "invalid_json"})
            return

        address_raw = (body.get("address") or "").strip()
        init_data = (body.get("init_data") or "").strip()

        if not address_raw or not init_data:
            self._json(400, {"error": "missing_fields"})
            return

        address = normalize_address(address_raw)
        if not address:
            self._json(400, {"error": "invalid_address"})
            return

        verified = verify_telegram_init_data(init_data, settings.telegram_bot_token)
        if verified is None:
            self._json(401, {"error": "invalid_signature"})
            return

        user = verified.get("user", {})
        user_id = user.get("id")
        if not user_id:
            self._json(400, {"error": "missing_user_id"})
            return

        base = settings.relayer_api_url.rstrip("/")
        headers = {
            "Authorization": f"Bearer {settings.relayer_api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = httpx.put(
                f"{base}/api/v1/bot/kv/wallet:{user_id}",
                json={"value": address},
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            logger.info("Wallet linked via API: user=%s", user_id)
            self._json(200, {"ok": True})
        except Exception as e:
            logger.exception(f"KV set error: {e}")
            self._json(500, {"error": "kv_error"})

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, data: dict) -> None:
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
