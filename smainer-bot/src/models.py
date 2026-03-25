"""Pydantic models shared across the Smainer Bot serverless modules.

Task results arrive via Vercel function at /api/callback/complete.
Routing state (chat_id, message_id) is encoded in callback URL query params.
"""

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# AI inference
# ---------------------------------------------------------------------------


class ModelTier(str, Enum):
    """Available model size tiers — maps to VRAM requirements."""

    SMALL = "small"    # ≤8B params, ≤10 GB VRAM
    MEDIUM = "medium"  # ≤34B params, ≤24 GB VRAM
    LARGE = "large"    # ≤70B+ params, ≤48 GB VRAM


MODEL_TIER_REQUIREMENTS: Dict[ModelTier, Dict[str, Any]] = {
    ModelTier.SMALL:  {"ram_gb": 16, "gpu_vram_gb": 10, "gpu_required": True},
    ModelTier.MEDIUM: {"ram_gb": 32, "gpu_vram_gb": 24, "gpu_required": True},
    ModelTier.LARGE:  {"ram_gb": 64, "gpu_vram_gb": 48, "gpu_required": True},
}


class InferenceRequest(BaseModel):
    """A single prompt request sent from the Telegram bot to the Relayer."""

    telegram_user_id: int
    chat_id: int
    message_id: int
    prompt: str = Field(min_length=1, max_length=4096)
    model: str = "llama3.1:8b"
    model_tier: ModelTier = ModelTier.SMALL
    starknet_address: str
    cost_strk: int  # wei


# ---------------------------------------------------------------------------
# Relayer API mirrors
# ---------------------------------------------------------------------------


class TaskSubmissionPayload(BaseModel):
    """Payload sent to POST /api/v1/tasks on the Relayer."""

    payload: Dict[str, Any]
    requirements: Dict[str, Any]
    token_amount: int
    description: Optional[str] = None


class TaskStatusResponse(BaseModel):
    """Subset of the Relayer TaskResponse we care about."""

    task_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    completion_time: Optional[str] = None


# ---------------------------------------------------------------------------
# Callbacks: Relayer → Bot (Vercel functions)
# ---------------------------------------------------------------------------


class TaskCallback(BaseModel):
    """Final payload pushed by the Relayer to /api/callback/complete."""

    task_id: str
    status: str  # "completed" | "failed"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    execution_time: Optional[float] = None
    # Routing fields — enriched by relayer from original task payload
    chat_id: Optional[int] = None
    message_id: Optional[int] = None
    # On-chain escrow task ID (if payment was made via escrow contract)
    on_chain_task_id: Optional[int] = None
