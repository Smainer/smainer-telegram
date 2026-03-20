"""Configuration for the Smainer Telegram Bot."""

import logging
import os
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Telegram
    telegram_bot_token: str = Field(
        description="Bot token from @BotFather"
    )

    # Relayer connection
    relayer_api_url: str = Field(
        default="http://localhost:8000",
        description="Smainer Relayer base URL",
    )
    relayer_api_key: str = Field(
        default="dev-api-key",
        description="Relayer API authentication key",
    )
    callback_signing_secret: str = Field(
        default="",
        description="HMAC secret for validating relayer callbacks",
    )
    relayer_callback_host: str = Field(
        default="http://localhost",
        description="Public base URL of this bot server so the relayer can push callbacks (e.g. http://138.197.11.147)",
    )
    relayer_callback_port: int = Field(
        default=8100,
        description="Port for the callback HTTP server that receives streaming results",
    )

    # Starknet
    starknet_rpc_url: str = Field(
        default="https://free-rpc.nethermind.io/mainnet-juno",
        description="Starknet JSON-RPC endpoint",
    )
    strk_token_address: str = Field(
        default="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        description="$STRK ERC-20 contract address",
    )
    smainer_contract_address: str = Field(
        default="0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe",
        description="SmainerEscrow contract address",
    )

    # Redis (separate DB from the relayer)
    redis_url: str = Field(
        default="redis://localhost:6379/1",
        description="Redis URL for bot session state",
    )

    # AI defaults
    default_model: str = Field(
        default="llama3.1:8b",
        description="Default AI model for inference",
    )
    min_strk_balance: int = Field(
        default=1_000_000_000_000_000_000,  # 1 STRK (18 decimals)
        description="Minimum $STRK balance required to use the bot",
    )
    prompt_cost_strk: int = Field(
        default=100_000_000_000_000_000,  # 0.1 STRK
        description="Cost per prompt in $STRK wei",
    )

    # MiniApp
    miniapp_url: str = Field(
        default="https://smainer-miniapp.vercel.app",
        description="Telegram MiniApp base URL (e.g. https://smainer-miniapp.vercel.app)",
    )
    miniapp_connect_url: str = Field(
        default="",
        description="Optional full URL for connect flow. If unset, uses MINIAPP_URL + '/connect'",
    )
    miniapp_open_url: str = Field(
        default="",
        description="Optional full URL for persistent Telegram menu button. If unset, uses MINIAPP_URL root",
    )

    # Logging
    log_level: str = Field(default="INFO", description="Logging level")
    environment: str = Field(default="development", description="Deployment environment")

    model_config = {
        "env_file": ".env" if os.path.exists(".env") else None,
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }

    @model_validator(mode="after")
    def _warn_dev_defaults(self) -> "Settings":
        """Log warnings for dangerous default values."""
        if self.relayer_api_key == "dev-api-key":
            logger.warning("RELAYER_API_KEY is using insecure default 'dev-api-key'")
        if "sepolia" in self.starknet_rpc_url.lower():
            logger.warning(
                "STARKNET_RPC_URL points to Sepolia testnet: %s",
                self.starknet_rpc_url,
            )
        if "localhost" in self.relayer_callback_host:
            logger.warning(
                "RELAYER_CALLBACK_HOST is localhost — callbacks from relayer will fail in production"
            )

        env = self.environment.lower()
        if env in {"production", "prod"}:
            if self.relayer_api_key == "dev-api-key":
                raise ValueError("RELAYER_API_KEY must not use dev default in production")
            if "localhost" in self.relayer_api_url.lower():
                raise ValueError("RELAYER_API_URL must not point to localhost in production")
            if "localhost" in self.relayer_callback_host.lower():
                raise ValueError("RELAYER_CALLBACK_HOST must be public in production")
            if not self.callback_signing_secret:
                raise ValueError("CALLBACK_SIGNING_SECRET must be set in production")

        return self

    def get_miniapp_connect_url(self) -> str:
        """Return the Connect Wallet URL used by /start keyboard button."""
        if self.miniapp_connect_url:
            return self.miniapp_connect_url.rstrip("/")
        return self.miniapp_url.rstrip("/") + "/connect"

    def get_miniapp_open_url(self) -> str:
        """Return the URL used by Telegram persistent menu button."""
        if self.miniapp_open_url:
            return self.miniapp_open_url.rstrip("/")
        return self.miniapp_url.rstrip("/")

    @model_validator(mode="after")
    def _validate_miniapp_urls(self) -> "Settings":
        """Validate MiniApp URLs early to prevent runtime 404 misconfiguration."""
        env = self.environment.lower()
        for value, name in (
            (self.miniapp_url, "MINIAPP_URL"),
            (self.miniapp_connect_url, "MINIAPP_CONNECT_URL"),
            (self.miniapp_open_url, "MINIAPP_OPEN_URL"),
        ):
            if not value:
                continue
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError(f"{name} must be a valid absolute http(s) URL")
            if env in {"production", "prod"} and parsed.scheme != "https":
                raise ValueError(f"{name} must use https in production")
        return self


settings = Settings()
