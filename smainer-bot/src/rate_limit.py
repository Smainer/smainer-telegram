"""Simple KV-backed rate limiter for Vercel serverless functions.

Uses the Relayer KV store to track per-user request counts within
a sliding time window. Each key is `rl:{endpoint}:{user_id}:{window}`
where window = current_time // window_seconds.

Thread-safe for serverless because each request is an isolated invocation.
"""

import logging
import time
from typing import Optional

import httpx

from .config import settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 5  # seconds for KV calls


def _kv_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.relayer_api_key}",
        "Content-Type": "application/json",
    }


def check_rate_limit(
    endpoint: str,
    user_id: str,
    max_requests: int = 20,
    window_seconds: int = 60,
) -> bool:
    """Check if the user is within rate limits. Returns True if allowed.

    Args:
        endpoint: Short name for the endpoint (e.g. "wallet-check")
        user_id: Telegram user ID or IP address
        max_requests: Maximum requests per window
        window_seconds: Window duration in seconds

    Returns:
        True if the request is allowed, False if rate-limited.
    """
    base = settings.relayer_api_url.rstrip("/")
    if not base or not settings.relayer_api_key:
        # No relayer configured — allow (dev mode)
        return True

    window = int(time.time()) // window_seconds
    key = f"rl:{endpoint}:{user_id}:{window}"

    try:
        # GET current count
        resp = httpx.get(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            timeout=DEFAULT_TIMEOUT,
        )

        current_count = 0
        if resp.status_code == 200:
            val = resp.json().get("value", "0")
            try:
                current_count = int(val)
            except (ValueError, TypeError):
                current_count = 0

        if current_count >= max_requests:
            logger.warning(
                "Rate limit exceeded: endpoint=%s user=%s count=%d",
                endpoint,
                user_id,
                current_count,
            )
            return False

        # INCREMENT: set count + 1 with TTL = window_seconds * 2
        httpx.put(
            f"{base}/api/v1/bot/kv/{key}",
            headers=_kv_headers(),
            json={"value": str(current_count + 1), "ttl_seconds": window_seconds * 2},
            timeout=DEFAULT_TIMEOUT,
        )

        return True

    except Exception as e:
        # Rate limiting failure should not block the request
        logger.warning("Rate limit check failed (allowing): %s", e)
        return True


def check_rate_limit_by_ip(
    endpoint: str,
    ip_address: Optional[str],
    max_requests: int = 60,
    window_seconds: int = 60,
) -> bool:
    """IP-based rate limiting fallback when user_id is not available."""
    if not ip_address:
        return True
    # Use a hash prefix to avoid storing full IPs
    import hashlib
    ip_hash = hashlib.sha256(ip_address.encode()).hexdigest()[:16]
    return check_rate_limit(endpoint, f"ip:{ip_hash}", max_requests, window_seconds)
