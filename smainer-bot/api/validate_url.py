"""Vercel serverless function: POST /api/validate-url

Validates deep-link return URLs against approved smainer.io/* pattern only.
Used by MiniApp to ensure wallet redirect URLs are secure before use.

Security:
    - Domain allowlist enforcement 
    - Bot domain exclusion (prevents self-referential attacks)
    - HTTPS enforcement
    - Rate limiting per IP
"""

import json
import logging
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from src.url_validator import validate_return_url, validate_braavos_connect_url
from src.rate_limit import check_rate_limit_by_ip

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for POST /api/validate-url."""

    def do_OPTIONS(self) -> None:  # noqa: N802
        """Handle CORS preflight."""
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        """Validate URL against security allowlist."""
        # Rate limit by IP: 100 validations per minute
        client_ip = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if not client_ip:
            try:
                client_ip = self.client_address[0]
            except (AttributeError, IndexError):
                client_ip = ""
                
        if not check_rate_limit_by_ip("url-validation", client_ip, max_requests=100, window_seconds=60):
            self._send_json_response(429, {"error": "rate_limited"})
            return

        # Parse request body
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)
        
        try:
            body = json.loads(raw_body)
        except (json.JSONDecodeError, ValueError):
            self._send_json_response(400, {"error": "invalid_json"})
            return

        url = body.get("url", "").strip()
        validation_type = body.get("type", "return_url")  # "return_url" or "braavos_connect"
        
        if not url:
            self._send_json_response(400, {"error": "missing_url"})
            return

        try:
            if validation_type == "braavos_connect":
                # Extract host from URL or use as-is if it's just a host
                if url.startswith("http"):
                    parsed = urlparse(url)
                    host = parsed.netloc
                else:
                    host = url
                    
                validated_url = validate_braavos_connect_url(host)
                if validated_url:
                    self._send_json_response(200, {
                        "valid": True,
                        "validated_url": validated_url,
                        "message": "Braavos connect URL validated"
                    })
                else:
                    self._send_json_response(200, {
                        "valid": False,
                        "error": "invalid_host_domain",
                        "message": f"Host '{host}' not in approved domains"
                    })
            else:
                # Default: validate return URL
                is_valid = validate_return_url(url)
                if is_valid:
                    self._send_json_response(200, {
                        "valid": True,
                        "message": "URL validated against security allowlist"
                    })
                else:
                    self._send_json_response(200, {
                        "valid": False,
                        "error": "blocked_domain",
                        "message": "URL not in approved domains or blocked for security"
                    })
                    
        except Exception as e:
            logger.exception(f"URL validation error: {e}")
            self._send_json_response(500, {"error": "internal_error"})

    def _send_cors_headers(self) -> None:
        """Add CORS headers for MiniApp access."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
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