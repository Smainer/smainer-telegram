"""Tests for src/callback_auth.py — HMAC-SHA256 verification."""

import hashlib
import hmac
import time
from unittest.mock import patch, MagicMock

import pytest

from src.callback_auth import verify_callback_signature, TIMESTAMP_TOLERANCE_SECONDS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TEST_SECRET = "test-signing-secret"


def _make_signature(body: bytes, timestamp: str, secret: str = TEST_SECRET) -> str:
    """Reproduce the Relayer signing scheme: HMAC(timestamp + "." + body)."""
    payload = timestamp.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestVerifyCallbackSignatureValid:
    def test_valid_signature_passes(self):
        body = b'{"task_id":"abc","chunk":"hello","done":false}'
        ts = str(int(time.time()))
        sig = _make_signature(body, ts)

        assert verify_callback_signature(body, ts, sig) is True

    def test_valid_signature_at_tolerance_boundary(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()) - TIMESTAMP_TOLERANCE_SECONDS + 1)
        sig = _make_signature(body, ts)

        assert verify_callback_signature(body, ts, sig) is True

    def test_valid_with_empty_body(self):
        body = b""
        ts = str(int(time.time()))
        sig = _make_signature(body, ts)

        assert verify_callback_signature(body, ts, sig) is True


# ---------------------------------------------------------------------------
# Invalid signatures
# ---------------------------------------------------------------------------


class TestVerifyCallbackSignatureInvalid:
    def test_wrong_signature_rejected(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()))
        sig = "deadbeef" * 8  # wrong

        assert verify_callback_signature(body, ts, sig) is False

    def test_tampered_body_rejected(self):
        body = b'{"data":"original"}'
        ts = str(int(time.time()))
        sig = _make_signature(body, ts)

        tampered = b'{"data":"tampered"}'
        assert verify_callback_signature(tampered, ts, sig) is False

    def test_tampered_timestamp_rejected(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()))
        sig = _make_signature(body, ts)

        wrong_ts = str(int(ts) + 1)
        assert verify_callback_signature(body, wrong_ts, sig) is False


# ---------------------------------------------------------------------------
# Missing headers
# ---------------------------------------------------------------------------


class TestVerifyCallbackSignatureMissing:
    def test_missing_sig_header(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()))
        assert verify_callback_signature(body, ts, None) is False

    def test_missing_timestamp(self):
        body = b'{"data":"x"}'
        sig = "abc123"
        assert verify_callback_signature(body, None, sig) is False

    def test_both_missing(self):
        assert verify_callback_signature(b"data", None, None) is False


# ---------------------------------------------------------------------------
# Timestamp tolerance / replay protection
# ---------------------------------------------------------------------------


class TestTimestampTolerance:
    def test_expired_timestamp_rejected(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()) - TIMESTAMP_TOLERANCE_SECONDS - 10)
        sig = _make_signature(body, ts)

        assert verify_callback_signature(body, ts, sig) is False

    def test_future_timestamp_rejected(self):
        body = b'{"data":"x"}'
        ts = str(int(time.time()) + TIMESTAMP_TOLERANCE_SECONDS + 10)
        sig = _make_signature(body, ts)

        assert verify_callback_signature(body, ts, sig) is False

    def test_non_numeric_timestamp(self):
        body = b'{"data":"x"}'
        sig = _make_signature(body, "not-a-number")
        assert verify_callback_signature(body, "not-a-number", sig) is False

    def test_empty_timestamp(self):
        body = b'{"data":"x"}'
        assert verify_callback_signature(body, "", "some-sig") is False


# ---------------------------------------------------------------------------
# Dev mode (no secret configured)
# ---------------------------------------------------------------------------


class TestDevModeNoSecret:
    def test_no_secret_configured_allows_all(self):
        """When CALLBACK_SIGNING_SECRET is empty, verification is skipped."""
        with patch("src.callback_auth.settings") as mock_settings:
            mock_settings.callback_signing_secret = ""
            assert verify_callback_signature(b"anything", None, None) is True

    def test_no_secret_configured_with_headers_still_allows(self):
        with patch("src.callback_auth.settings") as mock_settings:
            mock_settings.callback_signing_secret = ""
            assert verify_callback_signature(b"data", "123", "sig") is True
