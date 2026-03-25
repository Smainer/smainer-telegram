"""Vercel serverless function: GET /api/wallet-check

Returns the linked wallet address for a Telegram user, validating the
Telegram initData signature for security.

This endpoint is called by the MiniApp to check if the user already has
a linked wallet (via /link command or previous MiniApp connection).

Response:
    200: {"linked": true, "address": "0x..."}
    200: {"linked": false}
    400: Invalid initData
    401: Signature verification failed
"""

import hashlib
import hmac
import json
import logging
import urllib.parse
from http.server import BaseHTTPRequestHandler

from src.config import settings
from src.relayer_client import RelayerClient

logger = logging.getLogger(__name__)


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict | None:
    """Verify Telegram WebApp initData signature.
    
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
        self._send_cors_headers()
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        import asyncio
        
        # Parse query string
        path_parts = self.path.split("?", 1)
        query_string = path_parts[1] if len(path_parts) > 1 else ""
        params = urllib.parse.parse_qs(query_string)
        
        # Get initData from query params
        init_data = params.get("initData", [""])[0]
        
        if not init_data:
            self._send_json_response(400, {"error": "missing_init_data"})
            return
        
        # Verify signature
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
        
        # Check wallet link via Relayer KV
        try:
            address = asyncio.run(self._get_linked_wallet(user_id))
            
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

    async def _get_linked_wallet(self, user_id: int) -> str | None:
        """Query relayer KV for linked wallet address."""
        relayer = RelayerClient(callback_base_url=settings.callback_base_url)
        return await relayer.kv_get(f"wallet:{user_id}")

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
