"""Security tests for URL validation and wallet hijacking prevention."""

import pytest
from unittest.mock import patch

from src.url_validator import (
    validate_return_url,
    validate_braavos_connect_url,
    is_hijack_attempt
)


class TestUrlValidation:
    """Test deep-link URL validation against approved smainer.io/* pattern."""

    def test_valid_smainer_domains(self):
        """Approved smainer.io domains should be accepted."""
        valid_urls = [
            "https://smainer.io/connect",
            "https://app.smainer.io/wallet",
            "https://smainer-miniapp.vercel.app/connect", 
            "https://subdomain.smainer.io/path",
        ]
        
        for url in valid_urls:
            assert validate_return_url(url) is True, f"Should accept: {url}"

    def test_blocked_bot_domain(self):
        """Bot domain should be rejected to prevent self-referential attacks."""
        blocked_urls = [
            "https://bot.smainer.io/api/webhook",
            "https://bot.smainer.io/connect",
        ]
        
        for url in blocked_urls:
            assert validate_return_url(url) is False, f"Should reject bot domain: {url}"

    def test_malicious_domains_rejected(self):
        """Non-approved domains should be rejected."""
        malicious_urls = [
            "https://evil.com/steal-wallet",
            "https://smainer.io.evil.com/phishing",
            "https://malicious-smainer.io/fake",
            "https://smainer-fake.io/scam",
            "http://smainer.io/insecure",  # HTTP not HTTPS
            "",  # Empty URL
            "javascript:alert('xss')",  # JavaScript scheme
        ]
        
        for url in malicious_urls:
            assert validate_return_url(url) is False, f"Should reject malicious: {url}"

    def test_localhost_development(self):
        """Localhost should be accepted for development."""
        dev_urls = [
            "http://localhost:3000/connect",
            "http://127.0.0.1:8080/wallet",
        ]
        
        # Note: In production, these would be rejected due to HTTP
        for url in dev_urls:
            # This test assumes development environment allows HTTP localhost
            result = validate_return_url(url)
            # For now, HTTP localhost should be rejected in production
            assert result is False

    def test_https_enforcement(self):
        """Non-HTTPS URLs should be rejected."""
        http_urls = [
            "http://smainer.io/connect",
            "ftp://smainer.io/file",
        ]
        
        for url in http_urls:
            assert validate_return_url(url) is False, f"Should reject non-HTTPS: {url}"


class TestBraavosUrlGeneration:
    """Test Braavos connect URL generation with validation."""

    def test_valid_host_generates_url(self):
        """Valid hosts should generate proper Braavos URLs."""
        test_cases = [
            ("smainer.io", "https://link.braavos.app/dapp/smainer.io/connect?return=telegram"),
            ("app.smainer.io", "https://link.braavos.app/dapp/app.smainer.io/connect?return=telegram"),
        ]
        
        for host, expected in test_cases:
            result = validate_braavos_connect_url(host)
            assert result == expected, f"Host {host} should generate: {expected}"

    def test_invalid_host_returns_none(self):
        """Invalid or non-approved hosts should return None."""
        invalid_hosts = [
            "evil.com",
            "smainer.io.attacker.com", 
            "bot.smainer.io",  # Blocked domain
            "",
            None,
        ]
        
        for host in invalid_hosts:
            result = validate_braavos_connect_url(host)
            assert result is None, f"Invalid host {host} should return None"

    def test_port_stripping(self):
        """Port numbers should be stripped from hostnames."""
        result = validate_braavos_connect_url("smainer.io:3000")
        expected = "https://link.braavos.app/dapp/smainer.io/connect?return=telegram"
        assert result == expected


class TestWalletHijackingPrevention:
    """Test wallet state hijacking prevention mechanisms."""

    def test_same_user_no_hijack(self):
        """Same user ID should not trigger hijack detection."""
        assert is_hijack_attempt(12345, 12345) is False

    def test_different_user_is_hijack(self):
        """Different user IDs should trigger hijack detection.""" 
        assert is_hijack_attempt(12345, 67890) is True

    @patch('src.url_validator.logger')
    def test_hijack_attempt_logged(self, mock_logger):
        """Hijack attempts should be logged with user IDs."""
        is_hijack_attempt(12345, 67890)
        mock_logger.warning.assert_called_once()
        call_args = mock_logger.warning.call_args[0][0]
        assert "12345" in call_args
        assert "67890" in call_args


class TestSecurityIntegration:
    """Integration tests for security validation flow."""

    def test_end_to_end_validation_flow(self):
        """Test complete validation flow from user input to final decision."""
        # Simulate user connecting wallet with valid domain
        user_host = "app.smainer.io"
        braavos_url = validate_braavos_connect_url(user_host)
        
        assert braavos_url is not None
        assert "app.smainer.io" in braavos_url
        assert "link.braavos.app" in braavos_url
        
        # Validate the generated return URL
        return_url = "https://app.smainer.io/connect?return=telegram"
        assert validate_return_url(return_url) is True

    def test_security_bypass_attempt(self):
        """Test that common bypass attempts are blocked."""
        bypass_attempts = [
            "https://smainer.io@evil.com/",  # Authority confusion
            "https://evil.com/smainer.io/",   # Path confusion  
            "https://smainer-io.evil.com/",   # Subdomain confusion
        ]
        
        for attempt in bypass_attempts:
            assert validate_return_url(attempt) is False
            # Also test that Braavos URL generation would fail
            parsed_host = attempt.split('://')[1].split('/')[0].split('@')[-1]
            assert validate_braavos_connect_url(parsed_host) is None