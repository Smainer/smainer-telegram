"""Configuration for the Smainer Bot — Vercel serverless edition.

All values are loaded from environment variables (set via Vercel dashboard
in production, or a local .env file during development).
"""

import re
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

# Starknet address: 0x followed by 1-64 hex digits
_STARKNET_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{1,64}$")


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
        default="https://smainer-miniapp.vercel.app",
        description="Telegram MiniApp base URL (NOT app.smainer.io which is the web frontend)",
    )

    # ------------------------------------------------------------------
    # Callback URLs (for Vercel serverless)
    # ------------------------------------------------------------------
    callback_base_url: str = Field(
        default="https://bot.smainer.io",
        description="Base URL for relayer callbacks (stream/complete endpoints)",
    )

    # ------------------------------------------------------------------
    # Affiliate Program
    # ------------------------------------------------------------------
    affiliate_address: Optional[str] = Field(
        default=None,
        description=(
            "Starknet wallet address for affiliate fee collection. "
            "Earns 5% of task fees routed through this bot instance. "
            "Must match 0x[0-9a-fA-F]{1,64}."
        ),
    )

    @field_validator("affiliate_address", mode="before")
    @classmethod
    def _validate_affiliate_address(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not _STARKNET_ADDRESS_RE.match(v):
            return None
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    def get_miniapp_connect_url(self) -> str:
        """Return the MiniApp URL for wallet connection flow.

        Points to the base MiniApp URL — the app handles wallet
        connection in its onboarding screen.
        """
        return self.miniapp_url

    def get_miniapp_open_url(self) -> str:
        """Return the MiniApp URL for general app access."""
        return self.miniapp_url

    def get_miniapp_pay_url(
        self,
        prompt: str,
        tier: str,
        chat_id: int,
        message_id: int,
        nonce: str = "",
    ) -> str:
        """Return the MiniApp URL for the payment flow with encoded parameters."""
        from urllib.parse import urlencode

        base = self.miniapp_url.rstrip("/")
        params: dict = {
            "action": "pay",
            "prompt": prompt,
            "tier": tier,
            "chat_id": str(chat_id),
            "message_id": str(message_id),
        }
        if nonce:
            params["nonce"] = nonce
        return f"{base}/?{urlencode(params)}"


settings = Settings()
