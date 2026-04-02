"""KV-backed session manager with 15-minute idle timeout.

Implements TM-004: wallet sessions expire after 15 minutes of inactivity.
Session state is stored in the Relayer KV store with TTL.

Key format: ``sess:{hmac_user_hash}``
Value format: ``{last_activity_unix_ts}``
"""

import hashlib
import hmac
import logging
import time
from typing import Optional

import httpx

from .config import settings

logger = logging.getLogger(__name__)

# 15-minute idle timeout
SESSION_IDLE_TIMEOUT_SECONDS = 900

# KV TTL slightly longer than idle timeout to allow grace period
SESSION_KV_TTL_SECONDS = SESSION_IDLE_TIMEOUT_SECONDS + 60

DEFAULT_TIMEOUT = 5


def _kv_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.relayer_api_key}",
        "Content-Type": "application/json",
    }


def _session_key(user_id: int) -> str:
    """Derive a session KV key. Uses HMAC when key is available."""
    hmac_key = settings.wallet_hmac_key
    if hmac_key:
        digest = hmac.new(
            hmac_key.encode("utf-8"),
            str(user_id).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"sess:{digest[:32]}"
    return f"sess:{user_id}"


def touch_session(user_id: int) -> None:
    """Update the user's session last-activity timestamp.

    Called on every handler invocation to keep the session alive.
    """
    base = settings.relayer_api_url.rstrip("/")
    if not base or not settings.relayer_api_key:
        return

    key = _session_key(user_id)
    now = str(int(time.time()))

    try:
        httpx.put(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            json={"value": now, "ttl_seconds": SESSION_KV_TTL_SECONDS},
            timeout=DEFAULT_TIMEOUT,
        )
    except Exception as e:
        logger.warning("Failed to touch session: %s", e)


def check_session_active(user_id: int) -> bool:
    """Check if the user has an active (non-expired) session.

    Returns True if:
    - Session exists and last activity was within SESSION_IDLE_TIMEOUT_SECONDS, OR
    - KV is unavailable (fail-open for availability)

    Returns False if session has expired (idle > 15 minutes).
    """
    base = settings.relayer_api_url.rstrip("/")
    if not base or not settings.relayer_api_key:
        return True  # Fail-open in dev mode

    key = _session_key(user_id)

    try:
        resp = httpx.get(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            timeout=DEFAULT_TIMEOUT,
        )

        if resp.status_code == 404:
            # No session — user needs to start fresh
            return False

        resp.raise_for_status()
        value = resp.json().get("value", "")

        try:
            last_activity = int(value)
        except (ValueError, TypeError):
            return False

        elapsed = int(time.time()) - last_activity
        if elapsed > SESSION_IDLE_TIMEOUT_SECONDS:
            logger.info(
                "Session expired: user idle for %ds (limit=%ds)",
                elapsed,
                SESSION_IDLE_TIMEOUT_SECONDS,
            )
            return False

        return True

    except Exception as e:
        logger.warning("Session check failed (fail-open): %s", e)
        return True  # Fail-open for availability


def invalidate_session(user_id: int) -> None:
    """Explicitly invalidate a user's session (e.g. on /unlink)."""
    base = settings.relayer_api_url.rstrip("/")
    if not base or not settings.relayer_api_key:
        return

    key = _session_key(user_id)
    try:
        httpx.delete(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            timeout=DEFAULT_TIMEOUT,
        )
    except Exception as e:
        logger.warning("Failed to invalidate session: %s", e)
