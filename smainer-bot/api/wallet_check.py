"""Vercel serverless function: GET /api/wallet-check

Returns the linked wallet address for a Telegram user, validating the
Telegram initData signature for security.

This endpoint is called by the MiniApp to check if the user already has
a linked wallet (via /link command or previous MiniApp connection).

Security:
    - Telegram initData HMAC-SHA256 signature verification
    - auth_date max-age enforcement (300s)
    - Per-user rate limiting via Relayer KV

Response:
    200: {"linked": true, "address": "0x..."}
    200: {"linked": false}
    400: Invalid initData
    401: Signature verification failed
    429: Rate limited
"""

import hashlib
import hmac
import json
import logging
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler

import httpx

from src.config import settings
from src.rate_limit import check_rate_limit

logger = logging.getLogger(__name__)

# Maximum age of initData auth_date (seconds)
INIT_DATA_MAX_AGE = 300


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict | None:
    """Verify Telegram WebApp initData signature and enforce max-age.
    
    See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    
    Returns:
        Parsed data dict if valid, None if invalid.
    """
    try:
        # Parse the init_data as URL-encoded string
        parsed = urllib.parse.parse_qs(init_data, keep_blank_values=True)
        
        # Extract hash
        received_hash = parsed.get("hash", [""])[0]
        if not received_hash:
            return None
        
        # Enforce auth_date max-age
        auth_date_str = parsed.get("auth_date", [""])[0]
        if auth_date_str:
            try:
                auth_date = int(auth_date_str)
                age = abs(int(time.time()) - auth_date)
                if age > INIT_DATA_MAX_AGE:
                    logger.warning(
                        "initData expired: auth_date=%d age=%ds max=%ds",
                        auth_date, age, INIT_DATA_MAX_AGE,
                    )
                    return None
            except ValueError:
                logger.warning("Invalid auth_date format")
                return None
        
        # Remove hash from data for verification
        data_pairs = []
        for key, values in parsed.items():
            if key != "hash":
                # parse_qs returns lists; we need the first value
                data_pairs.append(f"{key}={values[0]}")
        
        # Sort alphabetically and join with newlines
        data_pairs.sort()
        data_check_string = "\n".join(data_pairs)
        
        # Create secret key: HMAC-SHA256("WebAppData", bot_token)
        secret_key = hmac.new(
            b"WebAppData",
            bot_token.encode("utf-8"),
            hashlib.sha256
        ).digest()
        
        # Calculate expected hash
        expected_hash = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        
        # Verify
        if not hmac.compare_digest(received_hash, expected_hash):
            logger.warning("initData signature mismatch")
            return None
        
        # Parse user data
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
    """Vercel Python function handler for GET /api/wallet-check."""

    def do_OPTIONS(self) -> None:  # noqa: N802
        """Handle CORS preflight."""
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        # Parse query string
        path_parts = self.path.split("?", 1)
        query_string = path_parts[1] if len(path_parts) > 1 else ""
        params = urllib.parse.parse_qs(query_string)
        
        # Get initData from query params
        init_data = params.get("initData", [""])[0]
        
        if not init_data:
            self._send_json_response(400, {"error": "missing_init_data"})
            return
        
        # Verify signature and max-age
        verified = verify_telegram_init_data(init_data, settings.telegram_bot_token)
        if not verified:
            self._send_json_response(401, {"error": "invalid_signature"})
            return
        
        # Extract user ID
        user = verified.get("user", {})
        user_id = user.get("id")
        
        if not user_id:
            self._send_json_response(400, {"error": "missing_user_id"})
            return

        # Rate limit: 20 requests per minute per user
        if not check_rate_limit("wallet-check", str(user_id), max_requests=20, window_seconds=60):
            self._send_json_response(429, {"error": "rate_limited"})
            return
        
        # Check wallet link via Relayer KV
        try:
            address = self._get_linked_wallet(user_id)
            
            if address:
                self._send_json_response(200, {
                    "linked": True,
                    "address": address,
                })
            else:
                self._send_json_response(200, {"linked": False})
                
        except Exception as e:
            logger.exception(f"Error checking wallet: {e}")
            self._send_json_response(500, {"error": "internal_error"})

    def _get_linked_wallet(self, user_id: int) -> str | None:
        """Query relayer KV for linked wallet address (sync)."""
        base = settings.relayer_api_url.rstrip("/")
        headers = {
            "Authorization": f"Bearer {settings.relayer_api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = httpx.get(
                f"{base}/api/v1/bot/kv/wallet:{user_id}",
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json().get("value")
        except Exception as e:
            logger.warning(f"KV get error: {e}")
            return None

    def _send_cors_headers(self) -> None:
        """Add CORS headers for MiniApp access."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json_response(self, status: int, data: dict) -> None:
        """Send JSON response with CORS headers."""
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
