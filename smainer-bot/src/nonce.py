"""Payment nonce generation and verification.

Nonces are single-use tokens issued by the bot when presenting the
"Pay & Compute" button. They prevent replay attacks on the standalone
browser payment-complete endpoint.

Storage: Relayer KV with TTL. Key format: `pay_nonce:{nonce_value}`.
Value: `{user_id}:{chat_id}:{timestamp}`.
"""

import logging
import secrets
import time
from typing import Optional, Tuple

import httpx

from .config import settings

logger = logging.getLogger(__name__)

# Nonce must be used within 10 minutes
NONCE_TTL_SECONDS = 600
DEFAULT_TIMEOUT = 10


def _kv_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.relayer_api_key}",
        "Content-Type": "application/json",
    }


def generate_nonce(user_id: int, chat_id: int) -> str:
    """Generate a payment nonce and store it in KV.

    Returns the nonce string to be included in the MiniApp pay URL.
    """
    nonce = secrets.token_urlsafe(32)
    base = settings.relayer_api_url.rstrip("/")
    key = f"pay_nonce:{nonce}"
    value = f"{user_id}:{chat_id}:{int(time.time())}"

    try:
        httpx.put(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            json={"value": value, "ttl_seconds": NONCE_TTL_SECONDS},
            timeout=DEFAULT_TIMEOUT,
        )
        logger.info("Payment nonce generated for user=%s", user_id)
    except Exception as e:
        logger.error("Failed to store nonce in KV: %s", e)
        # Continue anyway — nonce verification will fail gracefully

    return nonce


def verify_and_consume_nonce(
    nonce: str,
    expected_chat_id: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """Verify a payment nonce exists, is valid, and consume it.

    Args:
        nonce: The nonce string from the MiniApp.
        expected_chat_id: Optional chat_id to validate against.

    Returns:
        (is_valid, user_id_str) — user_id from the nonce if valid.
    """
    if not nonce:
        return False, None

    base = settings.relayer_api_url.rstrip("/")
    key = f"pay_nonce:{nonce}"

    try:
        # GET nonce
        resp = httpx.get(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            timeout=DEFAULT_TIMEOUT,
        )

        if resp.status_code == 404:
            logger.warning("Nonce not found (expired or invalid)")
            return False, None

        resp.raise_for_status()
        value = resp.json().get("value", "")

        # Parse: "user_id:chat_id:timestamp"
        parts = value.split(":")
        if len(parts) != 3:
            logger.warning("Invalid nonce value format")
            return False, None

        nonce_user_id, nonce_chat_id, nonce_ts = parts

        # Check timestamp (within NONCE_TTL_SECONDS)
        try:
            ts = int(nonce_ts)
            if abs(int(time.time()) - ts) > NONCE_TTL_SECONDS:
                logger.warning("Nonce expired: age=%ds", abs(int(time.time()) - ts))
                return False, None
        except ValueError:
            return False, None

        # Optionally validate chat_id
        if expected_chat_id and str(expected_chat_id) != nonce_chat_id:
            logger.warning("Nonce chat_id mismatch: expected=%s got=%s",
                           expected_chat_id, nonce_chat_id)
            return False, None

        # DELETE nonce (consume — single use)
        try:
            httpx.delete(
                f"{base}/api/v1/bot/kv/{key}",
                headers=_kv_headers(),
                timeout=DEFAULT_TIMEOUT,
            )
        except Exception:
            logger.warning("Failed to delete consumed nonce (non-fatal)")

        return True, nonce_user_id

    except Exception as e:
        logger.error("Nonce verification failed: %s", e)
        return False, None
