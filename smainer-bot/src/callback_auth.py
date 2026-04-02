"""Shared HMAC-SHA256 callback verification for Relayer → Bot callbacks.

Used by both /api/callback/stream.py and /api/callback/complete.py
to avoid duplicated security logic.
"""

import hashlib
import hmac
import logging
import time

from .config import settings

logger = logging.getLogger(__name__)

# Maximum age of a callback timestamp (replay protection)
TIMESTAMP_TOLERANCE_SECONDS = 300


def verify_callback_signature(
    raw_body: bytes,
    timestamp: str | None,
    sig_header: str | None,
) -> bool:
    """Verify HMAC-SHA256 signature from the Relayer.

    The signature is computed as: HMAC-SHA256(timestamp + "." + body, secret)
    This matches the original callback_server.py signing scheme.

    SEC-001 fail-closed: rejects unsigned callbacks by default when
    CALLBACK_SIGNING_SECRET is unset.  To allow unsigned callbacks during
    local development, set SMAINER_CALLBACK_DEV_BYPASS=true explicitly.

    Args:
        raw_body: The raw request body bytes.
        timestamp: Value of X-Smainer-Timestamp header.
        sig_header: Value of X-Smainer-Signature header (hex digest).

    Returns:
        True if the signature is valid.
        True if explicit dev bypass is enabled (SMAINER_CALLBACK_DEV_BYPASS=true).
        False otherwise (fail-closed).
    """
    if not settings.callback_signing_secret:
        if settings.callback_dev_bypass:
            logger.warning(
                "SEC-001: CALLBACK_SIGNING_SECRET not set and "
                "SMAINER_CALLBACK_DEV_BYPASS=true — accepting unsigned callback "
                "(THIS MUST NOT BE USED IN PRODUCTION)"
            )
            return True
        logger.error(
            "SEC-001: CALLBACK_SIGNING_SECRET not set — rejecting callback "
            "(set the secret or enable SMAINER_CALLBACK_DEV_BYPASS=true for local dev)"
        )
        return False
    if not sig_header or not timestamp:
        return False

    # Verify timestamp tolerance (replay protection)
    try:
        timestamp_value = int(timestamp)
    except ValueError:
        logger.warning("Invalid timestamp format", extra={"timestamp": timestamp})
        return False

    current_time = int(time.time())
    if abs(current_time - timestamp_value) > TIMESTAMP_TOLERANCE_SECONDS:
        logger.warning(
            "Timestamp too old/future",
            extra={
                "timestamp": timestamp_value,
                "current": current_time,
                "diff": abs(current_time - timestamp_value),
            },
        )
        return False

    # Build the signed payload exactly as the Relayer does
    signing_payload = timestamp.encode("utf-8") + b"." + raw_body
    expected = hmac.new(
        settings.callback_signing_secret.encode("utf-8"),
        signing_payload,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, sig_header)
