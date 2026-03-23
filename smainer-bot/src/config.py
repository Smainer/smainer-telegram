"""Configuration for the Smainer Bot — Vercel serverless edition.

All values are loaded from environment variables (set via Vercel dashboard
in production, or a local .env file during development).
"""

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ------------------------------------------------------------------
    # Telegram
    # ------------------------------------------------------------------
    telegram_bot_token: str = Field(
        description="Bot token from @BotFather",
    )
    webhook_secret: str = Field(
        default="",
        description="Secret token used to verify Telegram webhook calls (X-Telegram-Bot-Api-Secret-Token header)",
    )

    # ------------------------------------------------------------------
    # Relayer
    # ------------------------------------------------------------------
    relayer_api_url: str = Field(
        default="https://api.smainer.io",
        description="Smainer Relayer base URL",
    )
    relayer_api_key: str = Field(
        default="",
        description="Relayer API authentication key",
    )

    # ------------------------------------------------------------------
    # Callback security
    # ------------------------------------------------------------------
    callback_signing_secret: str = Field(
        default="",
        description="HMAC-SHA256 secret used to verify relayer→bot callbacks",
    )

    # ------------------------------------------------------------------
    # Starknet
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # AI defaults
    # ------------------------------------------------------------------
    default_model: str = Field(
        default="llama3.1:8b",
        description="Default AI model for inference tasks",
    )
    min_strk_balance: int = Field(
        default=1_000_000_000_000_000_000,  # 1 STRK (18 decimals)
        description="Minimum $STRK balance required to use the bot (wei)",
    )
    prompt_cost_strk: int = Field(
        default=100_000_000_000_000_000,  # 0.1 STRK
        description="Cost per prompt in $STRK wei",
    )

    # ------------------------------------------------------------------
    # MiniApp
    # ------------------------------------------------------------------
    miniapp_url: str = Field(
        default="https://app.smainer.io",
        description="Telegram MiniApp base URL",
    )

    # ------------------------------------------------------------------
    # Callback URLs (for Vercel serverless)
    # ------------------------------------------------------------------
    callback_base_url: str = Field(
        default="https://bot.smainer.io",
        description="Base URL for relayer callbacks (stream/complete endpoints)",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    def get_miniapp_connect_url(self) -> str:
        """Return the MiniApp URL for wallet connection flow."""
        return f"{self.miniapp_url}/connect"

    def get_miniapp_open_url(self) -> str:
        """Return the MiniApp URL for general app access."""
        return self.miniapp_url


settings = Settings()
