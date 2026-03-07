"""Entry point for the Smainer Telegram Bot."""

import asyncio
import logging
import signal
import sys

import structlog

from .config import settings
from .handlers import SmainerBot

# ── Structured logging ────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_log_level,
        structlog.contextvars.merge_contextvars,
        structlog.processors.TimeStamper(fmt="ISO"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    format="%(message)s",
    stream=sys.stdout,
    level=getattr(logging, settings.log_level.upper()),
)

logger = structlog.get_logger(__name__)


async def _run() -> None:
    bot = SmainerBot()
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _signal_handler() -> None:
        logger.info("Received shutdown signal")
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_handler)

    try:
        await bot.start()
        logger.info("Smainer Telegram Bot running — press Ctrl+C to stop")
        await stop_event.wait()
    finally:
        await bot.stop()


def main() -> None:
    """CLI entry point."""
    asyncio.run(_run())


if __name__ == "__main__":
    main()
