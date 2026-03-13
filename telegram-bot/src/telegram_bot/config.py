"""Configuration for the Smainer Telegram Bot."""

from pydantic import Field
from pydantic_settings import BaseSettings


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
    relayer_callback_port: int = Field(
        default=8100,
        description="Port for the callback HTTP server that receives streaming results",
    )

    # Starknet
    starknet_rpc_url: str = Field(
        default="https://starknet-sepolia.public.blastapi.io",
        description="Starknet JSON-RPC endpoint",
    )
    strk_token_address: str = Field(
        default="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        description="$STRK ERC-20 contract address",
    )
    smainer_contract_address: str = Field(
        default="0x0747d450d0304b01f52c901bb362428b385c4a86f1e346c80b69a3b6df0da90d",
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

    # Logging
    log_level: str = Field(default="INFO", description="Logging level")

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


settings = Settings()
