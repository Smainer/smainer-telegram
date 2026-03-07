"""Lightweight HTTP server that receives callbacks from the Relayer.

The relayer pushes task results (streaming chunks and final completion)
to this server, which then forwards them to the correct Telegram chat.
"""

import asyncio
import logging
from typing import Callable, Coroutine, Any

from aiohttp import web

from .models import StreamChunk, TaskCallback

logger = logging.getLogger(__name__)


class CallbackServer:
    """Runs alongside the Telegram bot to receive relayer push notifications."""

    def __init__(self, port: int) -> None:
        self._port = port
        self._app = web.Application()
        self._runner: web.AppRunner | None = None

        # External handlers registered by the bot
        self._on_chunk: Callable[[StreamChunk], Coroutine[Any, Any, None]] | None = None
        self._on_complete: Callable[[TaskCallback], Coroutine[Any, Any, None]] | None = None

        self._app.router.add_post("/callback/stream", self._handle_stream)
        self._app.router.add_post("/callback/complete", self._handle_complete)
        self._app.router.add_get("/health", self._handle_health)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the aiohttp server."""
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "0.0.0.0", self._port)
        await site.start()
        logger.info("Callback server started", extra={"port": self._port})

    async def stop(self) -> None:
        """Gracefully stop."""
        if self._runner:
            await self._runner.cleanup()
            logger.info("Callback server stopped")

    # ------------------------------------------------------------------
    # Handler registration
    # ------------------------------------------------------------------

    def on_stream_chunk(
        self, handler: Callable[[StreamChunk], Coroutine[Any, Any, None]]
    ) -> None:
        self._on_chunk = handler

    def on_task_complete(
        self, handler: Callable[[TaskCallback], Coroutine[Any, Any, None]]
    ) -> None:
        self._on_complete = handler

    # ------------------------------------------------------------------
    # HTTP handlers
    # ------------------------------------------------------------------

    async def _handle_stream(self, request: web.Request) -> web.Response:
        """Receive a streaming text chunk from the relayer."""
        try:
            body = await request.json()
            chunk = StreamChunk.model_validate(body)
            if self._on_chunk:
                asyncio.create_task(self._on_chunk(chunk))
            return web.json_response({"ok": True})
        except Exception as exc:
            logger.error("Bad stream callback", extra={"error": str(exc)})
            return web.json_response({"error": "invalid payload"}, status=400)

    async def _handle_complete(self, request: web.Request) -> web.Response:
        """Receive a task completion / failure callback from the relayer."""
        try:
            body = await request.json()
            callback = TaskCallback.model_validate(body)
            if self._on_complete:
                asyncio.create_task(self._on_complete(callback))
            return web.json_response({"ok": True})
        except Exception as exc:
            logger.error("Bad complete callback", extra={"error": str(exc)})
            return web.json_response({"error": "invalid payload"}, status=400)

    async def _handle_health(self, _request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})
