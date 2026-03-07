"""Pydantic models shared across the Telegram bot modules."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Wallet / session
# ---------------------------------------------------------------------------


class LinkedWallet(BaseModel):
    """A Starknet wallet linked to a Telegram user."""

    telegram_user_id: int
    starknet_address: str
    linked_at: datetime = Field(default_factory=datetime.utcnow)
    last_balance_check: Optional[datetime] = None
    cached_balance: Optional[int] = None  # wei


# ---------------------------------------------------------------------------
# AI inference
# ---------------------------------------------------------------------------


class ModelTier(str, Enum):
    """Available model size tiers — mapped to VRAM requirements."""

    SMALL = "small"    # ≤8B params, ≤10 GB VRAM
    MEDIUM = "medium"  # ≤34B params, ≤24 GB VRAM
    LARGE = "large"    # ≤70B+ params, ≤48 GB VRAM


# Map tiers to concrete VRAM / RAM requirements for the relayer
MODEL_TIER_REQUIREMENTS = {
    ModelTier.SMALL: {"ram_gb": 16, "gpu_vram_gb": 10, "gpu_required": True},
    ModelTier.MEDIUM: {"ram_gb": 32, "gpu_vram_gb": 24, "gpu_required": True},
    ModelTier.LARGE: {"ram_gb": 64, "gpu_vram_gb": 48, "gpu_required": True},
}


class InferenceRequest(BaseModel):
    """A single prompt request sent from the Telegram bot."""

    telegram_user_id: int
    chat_id: int
    message_id: int
    prompt: str = Field(min_length=1, max_length=4096)
    model: str = "llama3.1:8b"
    model_tier: ModelTier = ModelTier.SMALL
    starknet_address: str
    cost_strk: int  # wei


class InferenceResult(BaseModel):
    """Result returned from the compute node via the relayer."""

    task_id: str
    status: str
    response_text: Optional[str] = None
    error: Optional[str] = None
    execution_time: Optional[float] = None
    node_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Relayer API mirrors (subset of relayer schemas)
# ---------------------------------------------------------------------------


class TaskSubmissionPayload(BaseModel):
    """Payload sent to the relayer POST /api/v1/tasks endpoint."""

    payload: Dict[str, Any]
    requirements: Dict[str, Any]
    token_amount: int
    description: Optional[str] = None


class TaskStatusResponse(BaseModel):
    """Subset of the relayer TaskResponse we care about."""

    task_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    completion_time: Optional[str] = None


# ---------------------------------------------------------------------------
# Callback from relayer → bot
# ---------------------------------------------------------------------------


class StreamChunk(BaseModel):
    """A streaming chunk pushed from the relayer callback."""

    task_id: str
    chunk: str  # partial text
    done: bool = False


class TaskCallback(BaseModel):
    """Final callback when a task completes or fails."""

    task_id: str
    status: str  # "completed" | "failed"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    execution_time: Optional[float] = None
