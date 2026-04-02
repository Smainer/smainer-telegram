"""HMAC-keyed storage mapping and optional Fernet encryption for wallet addresses.

Implements constraint 4: "Wallet addresses may be persisted using HMAC-keyed
mapping with optional value encryption for privacy hardening."

Storage key derivation:
    HMAC-SHA256(user_id, WALLET_HMAC_KEY) → hex digest used as KV key prefix.
    This prevents enumeration of wallet links by user_id.

Value encryption (optional, enabled when WALLET_ENCRYPTION_KEY is set):
    Fernet symmetric encryption of the wallet address before storage.
    Key must be a 32-byte URL-safe base64-encoded string.

Migration:
    When crypto keys are first enabled, existing plaintext records stored
    under ``wallet:{user_id}`` are transparently read, re-written to the
    new format, and the legacy key is deleted.  See ``decrypt_address``
    and ``plain_wallet_key`` for the fallback logic.
"""

import hashlib
import hmac
import logging
import re
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded Fernet instance (avoid import cost on cold start if unused)
_fernet = None

# Matches a 0x-prefixed hex address (Starknet style)
_PLAIN_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]+$")


def _get_fernet():
    """Lazy-load Fernet cipher using WALLET_ENCRYPTION_KEY."""
    global _fernet
    if _fernet is not None:
        return _fernet

    key = settings.wallet_encryption_key
    if not key:
        return None

    from cryptography.fernet import Fernet

    _fernet = Fernet(key.encode("utf-8"))
    return _fernet


def plain_wallet_key(user_id: int) -> str:
    """Return the legacy plain-text KV key for *user_id*.

    Always returns ``wallet:{user_id}`` regardless of whether
    WALLET_HMAC_KEY is configured.  Used during migration reads.
    """
    return f"wallet:{user_id}"


def derive_wallet_key(user_id: int) -> str:
    """Derive a privacy-preserving KV key for a user's wallet link.

    Uses HMAC-SHA256(str(user_id), WALLET_HMAC_KEY) so the raw user_id
    is never stored as a key in the KV store.

    Falls back to plain ``wallet:{user_id}`` when WALLET_HMAC_KEY is not set
    (development mode).
    """
    hmac_key = settings.wallet_hmac_key
    if not hmac_key:
        logger.debug("WALLET_HMAC_KEY not set — using plain wallet key (dev mode)")
        return f"wallet:{user_id}"

    digest = hmac.new(
        hmac_key.encode("utf-8"),
        str(user_id).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"wallet_h:{digest}"


def is_hmac_key_active() -> bool:
    """Return True when WALLET_HMAC_KEY is configured (i.e. new key format)."""
    return bool(settings.wallet_hmac_key)


def encrypt_address(address: str) -> str:
    """Encrypt a wallet address for storage.

    Returns the address unchanged when WALLET_ENCRYPTION_KEY is not configured.
    """
    f = _get_fernet()
    if f is None:
        return address
    return f.encrypt(address.encode("utf-8")).decode("utf-8")


def decrypt_address(stored: str) -> Optional[str]:
    """Decrypt a stored wallet address.

    Handles three scenarios:
    1. No WALLET_ENCRYPTION_KEY configured → return stored value as-is.
    2. Value is Fernet-encrypted → decrypt and return.
    3. Value is a legacy plaintext hex address (pre-encryption) but
       WALLET_ENCRYPTION_KEY is now set → recognise it and return as-is
       so the caller can transparently re-encrypt it.

    Returns None only if the value is neither valid Fernet nor a
    recognisable plaintext address (true corruption).
    """
    f = _get_fernet()
    if f is None:
        return stored

    try:
        return f.decrypt(stored.encode("utf-8")).decode("utf-8")
    except Exception:
        # Fernet failed — check if this is a legacy plaintext address
        if _PLAIN_ADDRESS_RE.match(stored):
            logger.info("Legacy plaintext wallet value detected; migration pending")
            return stored
        logger.error("Failed to decrypt wallet address — not Fernet and not plaintext hex")
        return None
