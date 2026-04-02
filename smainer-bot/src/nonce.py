"""Payment nonce generation and verification.

Nonces are single-use tokens issued by the bot when presenting the
"Pay & Compute" button. They prevent replay attacks on the standalone
browser payment-complete endpoint.

Storage: Relayer KV with TTL. Key format: `pay_nonce:{nonce_value}`.
Value: `{user_id}:{chat_id}:{created_ts}:{activated_ts}`.

TM-003 — Two-phase expiry (Constraint 3):
  Phase 1 (untouched): 5 minutes from creation. If nobody touches the nonce,
    it auto-expires via KV TTL.
  Phase 2 (active): Once the nonce is first validated (MiniApp opens payment),
    it transitions to "active" with a 5-minute session window counted from
    that activation moment. The nonce is consumed (deleted) after successful
    verification.
"""

import hmac
import logging
import secrets
import time
from typing import Optional, Tuple

import httpx

from .config import settings

logger = logging.getLogger(__name__)

# Phase 1: untouched nonce expires in 5 minutes
NONCE_UNTOUCHED_TTL_SECONDS = 300

# Phase 2: active session expires 5 minutes after activation
NONCE_ACTIVE_TTL_SECONDS = 300

# Total maximum age (hard cap) = untouched + active
NONCE_MAX_AGE_SECONDS = NONCE_UNTOUCHED_TTL_SECONDS + NONCE_ACTIVE_TTL_SECONDS

# Backward-compatible alias used by tests (maps to the hard-cap TTL)
NONCE_TTL_SECONDS = NONCE_MAX_AGE_SECONDS

DEFAULT_TIMEOUT = 10


def _kv_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.relayer_api_key}",
        "Content-Type": "application/json",
    }


def generate_nonce(user_id: int, chat_id: int) -> str:
    """Generate a payment nonce and store it in KV.

    Phase 1 starts now — KV TTL is set to NONCE_UNTOUCHED_TTL_SECONDS.
    activated_ts is '0' (not yet activated).

    Returns the nonce string to be included in the MiniApp pay URL.
    """
    nonce = secrets.token_urlsafe(32)
    base = settings.relayer_api_url.rstrip("/")
    key = f"pay_nonce:{nonce}"
    # Format: user_id:chat_id:created_ts:activated_ts
    value = f"{user_id}:{chat_id}:{int(time.time())}:0"

    try:
        httpx.put(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            json={"value": value, "ttl_seconds": NONCE_UNTOUCHED_TTL_SECONDS},
            timeout=DEFAULT_TIMEOUT,
        )
        logger.info("Payment nonce generated for user=%s", user_id)
    except Exception as e:
        logger.error("Failed to store nonce in KV: %s", e)

    return nonce


def verify_and_consume_nonce(
    nonce: str,
    expected_chat_id: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """Verify a payment nonce exists, is valid, and consume it.

    Two-phase expiry logic (Constraint 3):
    - If not yet activated: check Phase 1 age, then activate (set activated_ts)
      and extend KV TTL to NONCE_ACTIVE_TTL_SECONDS.
    - If already activated: check Phase 2 age from activated_ts, then consume
      (delete) the nonce.

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

        # Parse: "user_id:chat_id:created_ts:activated_ts"
        parts = value.split(":")
        if len(parts) < 3:
            logger.warning("Invalid nonce value format")
            return False, None

        nonce_user_id = parts[0]
        nonce_chat_id = parts[1]
        nonce_created_ts = parts[2]
        nonce_activated_ts = parts[3] if len(parts) > 3 else "0"

        now = int(time.time())

        # Hard cap: reject nonces older than NONCE_MAX_AGE_SECONDS
        try:
            created = int(nonce_created_ts)
            if now - created > NONCE_MAX_AGE_SECONDS:
                logger.warning("Nonce exceeded max age: %ds", now - created)
                _delete_nonce(base, key)
                return False, None
        except ValueError:
            return False, None

        # Optionally validate chat_id
        if expected_chat_id and str(expected_chat_id) != nonce_chat_id:
            logger.warning(
                "Nonce chat_id mismatch: expected=%s got=%s",
                expected_chat_id,
                nonce_chat_id,
            )
            return False, None

        # Two-phase logic
        activated = int(nonce_activated_ts) if nonce_activated_ts != "0" else 0

        if activated == 0:
            # Phase 1 → Phase 2 transition: check untouched age, then activate
            untouched_age = now - created
            if untouched_age > NONCE_UNTOUCHED_TTL_SECONDS:
                logger.warning("Nonce untouched timeout: age=%ds", untouched_age)
                _delete_nonce(base, key)
                return False, None

            # Activate: update value with activated_ts and extend TTL
            new_value = f"{nonce_user_id}:{nonce_chat_id}:{nonce_created_ts}:{now}"
            try:
                httpx.put(
                    f"{base}/api/v1/bot/kv/{key}",
                    headers=_kv_headers(),
                    json={"value": new_value, "ttl_seconds": NONCE_ACTIVE_TTL_SECONDS},
                    timeout=DEFAULT_TIMEOUT,
                )
                logger.info("Nonce activated (phase 2 started)")
            except Exception:
                logger.warning("Failed to activate nonce (non-fatal)")

            return True, nonce_user_id
        else:
            # Phase 2: check active session age, then consume
            active_age = now - activated
            if active_age > NONCE_ACTIVE_TTL_SECONDS:
                logger.warning("Nonce active session expired: age=%ds", active_age)
                _delete_nonce(base, key)
                return False, None

            # Consume (delete) — single use
            _delete_nonce(base, key)
            return True, nonce_user_id

    except Exception as e:
        logger.error("Nonce verification failed: %s", e)
        return False, None


def _delete_nonce(base: str, key: str) -> None:
    """Delete a nonce from KV (best-effort)."""
    try:
        httpx.delete(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            timeout=DEFAULT_TIMEOUT,
        )
    except Exception:
        logger.warning("Failed to delete nonce (non-fatal)")
