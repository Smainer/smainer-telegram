"""Vercel serverless function: GET /api/health

Returns a simple JSON health check. Used by monitoring, the Relayer's
pre-flight check, and the Vercel deployment smoke test.
"""

import json
import logging
from http.server import BaseHTTPRequestHandler

logger = logging.getLogger(__name__)


class handler(BaseHTTPRequestHandler):
    """Vercel Python function handler for GET /api/health."""

    def do_GET(self) -> None:  # noqa: N802
        payload = {"status": "ok", "service": "smainer-bot"}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.debug(format, *args)
