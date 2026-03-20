"""HTTP client for the Smainer Relayer REST API."""

import logging
from typing import Any, Dict, Optional

import httpx
from httpx import ConnectError, ReadTimeout, TimeoutException

from .config import settings
from .models import (
    InferenceRequest,
    ModelTier,
    MODEL_TIER_REQUIREMENTS,
    TaskStatusResponse,
    TaskSubmissionPayload,
)

logger = logging.getLogger(__name__)

# Default HTTP timeout in seconds
DEFAULT_TIMEOUT = 15


class RelayerClient:
    """Talks to the existing Smainer Relayer over its REST API."""

    def __init__(self, callback_url: str) -> None:
        self._base = settings.relayer_api_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {settings.relayer_api_key}",
            "Content-Type": "application/json",
        }
        self._callback_url = callback_url  # where the relayer pushes results back

    # ------------------------------------------------------------------
    # Task submission
    # ------------------------------------------------------------------

    async def submit_inference(self, req: InferenceRequest) -> Optional[str]:
        """Submit an AI inference task and return the task_id."""
        tier_reqs = MODEL_TIER_REQUIREMENTS[req.model_tier]

        payload = TaskSubmissionPayload(
            payload={
                "type": "ai_inference",
                "prompt": req.prompt,
                "model": req.model,
                "telegram_user_id": req.telegram_user_id,
                "chat_id": req.chat_id,
                "message_id": req.message_id,
                "callback_url": self._callback_url,
            },
            requirements={
                "cpu_threads": 4,
                "ram_gb": tier_reqs["ram_gb"],
                "gpu_required": tier_reqs["gpu_required"],
                "max_execution_time": 300,
            },
            token_amount=req.cost_strk,
            description=f"AI inference ({req.model}) via Telegram",
        )

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._base}/api/v1/tasks",
                headers=self._headers,
                json=payload.model_dump(),
            )
            if resp.status_code == 201:
                data = resp.json()
                task_id = data["task_id"]
                logger.info("Task submitted", extra={"task_id": task_id})
                return task_id
            else:
                logger.error(
                    "Relayer rejected task",
                    extra={"status": resp.status_code, "body": resp.text},
                )
                return None

    # ------------------------------------------------------------------
    # Polling fallback
    # ------------------------------------------------------------------

    async def get_task_status(self, task_id: str) -> Optional[TaskStatusResponse]:
        """Poll the relayer for task status (fallback when callbacks fail)."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=15.0)) as client:
                resp = await client.get(
                    f"{self._base}/api/v1/tasks/{task_id}",
                    headers=self._headers,
                )
                if resp.status_code == 200:
                    return TaskStatusResponse.model_validate(resp.json())
                elif resp.status_code == 404:
                    logger.warning(f"Task not found: {task_id}")
                    return None
                else:
                    logger.warning(f"Unexpected status code {resp.status_code} for task {task_id}")
                    return None
                    
        except httpx.RequestError as e:
            logger.warning(
                f"Network error getting task status for {task_id}",
                extra={"error_type": type(e).__name__, "error": str(e)}
            )
            return None
        except Exception as e:
            logger.error(
                f"Unexpected error getting task status for {task_id}",
                extra={"error_type": type(e).__name__, "error": str(e)}
            )
            return None

    # ------------------------------------------------------------------
    # Node discovery (for /models command)
    # ------------------------------------------------------------------

    async def list_available_models(self) -> list[Dict[str, Any]]:
        """Ask the relayer which GPU-capable nodes are online and their specs."""

        def infer_supported_tiers(
            gpu_vram_gb: float,
            ram_gb: int,
            node_tier: str,
        ) -> list[str]:
            """Infer Telegram model tiers from canonical relayer capability fields.

            Preference order:
            1) GPU VRAM (most accurate for model sizing)
            2) Relayer node_tier (basic/pro/premium)
            3) RAM heuristic fallback for legacy nodes
            """
            supported: list[str] = []

            if gpu_vram_gb > 0:
                for tier in ModelTier:
                    reqs = MODEL_TIER_REQUIREMENTS[tier]
                    if gpu_vram_gb >= float(reqs["gpu_vram_gb"]) * 0.9:
                        supported.append(tier.value)
                if not supported and gpu_vram_gb >= 8:
                    supported.append(ModelTier.SMALL.value)
                return supported

            # node_tier comes from relayer schema: basic/pro/premium
            node_tier = (node_tier or "").lower()
            if node_tier == "premium":
                return [ModelTier.SMALL.value, ModelTier.MEDIUM.value, ModelTier.LARGE.value]
            if node_tier == "pro":
                return [ModelTier.SMALL.value, ModelTier.MEDIUM.value]
            if node_tier == "basic":
                return [ModelTier.SMALL.value]

            # Legacy fallback when GPU metadata is missing.
            for tier in ModelTier:
                reqs = MODEL_TIER_REQUIREMENTS[tier]
                if ram_gb >= int(reqs["ram_gb"]) * 0.9:
                    supported.append(tier.value)
            if not supported and ram_gb >= 12:
                supported.append(ModelTier.SMALL.value)
            return supported

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.get(f"{self._base}/api/v1/nodes", headers=self._headers)
            if resp.status_code == 200:
                nodes = resp.json().get("nodes", [])
                models: list[Dict[str, Any]] = []

                for node in nodes:
                    hardware = node.get("hardware_spec", {})
                    gpu = hardware.get("gpu_info", "")
                    ram = int(hardware.get("ram_gb", 0) or 0)
                    gpu_vram = float(hardware.get("gpu_vram_gb", 0) or 0)
                    node_tier = str(hardware.get("node_tier", "") or "")

                    # Prefer explicit GPU fields; keep RAM fallback for legacy nodes.
                    has_gpu_capability = bool(gpu) or gpu_vram > 0 or ram >= 12
                    # PRO/PREMIUM strongly imply GPU capability even if metadata is incomplete.
                    if node_tier.lower() in {"pro", "premium"}:
                        has_gpu_capability = True
                    if not has_gpu_capability:
                        continue

                    supported = infer_supported_tiers(gpu_vram, ram, node_tier)

                    models.append(
                        {
                            "node_id": node["node_id"],
                            "gpu": gpu or f"Unknown GPU (RAM: {ram}GB)",
                            "ram_gb": ram,
                            "supported_tiers": supported,
                        }
                    )

                if models:
                    return models

            logger.warning(
                "Primary node discovery returned no usable GPU nodes",
                extra={"status_code": resp.status_code},
            )

            # Fallback to AI capable-nodes endpoint to avoid false negatives
            ai_resp = await client.get(f"{self._base}/api/v1/ai/capable-nodes", headers=self._headers)
            if ai_resp.status_code != 200:
                logger.warning(
                    "Fallback capable-nodes endpoint unavailable",
                    extra={"status_code": ai_resp.status_code},
                )
                return []

            fallback_nodes = ai_resp.json()
            models: list[Dict[str, Any]] = []
            for node in fallback_nodes:
                ram = int(node.get("ram_gb", 0) or 0)
                gpu_vram = float(node.get("vram_gb", 0) or 0)
                supported = infer_supported_tiers(gpu_vram, ram, "")

                models.append(
                    {
                        "node_id": node.get("node_id", "unknown"),
                        "gpu": node.get("gpu") or f"Unknown GPU (RAM: {ram}GB)",
                        "ram_gb": ram,
                        "supported_tiers": supported,
                    }
                )
            return models
