"""HTTP client for the Smainer Relayer REST API.

Serverless edition: uses httpx (sync or async) per invocation.
No persistent connection pool — Vercel functions are stateless.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from .config import settings
from .models import (
    MODEL_TIER_REQUIREMENTS,
    InferenceRequest,
    ModelTier,
    TaskStatusResponse,
    TaskSubmissionPayload,
)

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 15  # seconds


class RelayerClient:
    """Talks to the Smainer Relayer over its REST API.

    Usage (inside a Vercel function):
        client = RelayerClient(callback_base_url="https://smainer-bot.vercel.app")
        task_id = await client.submit_inference(req)
    """

    def __init__(self, callback_base_url: str) -> None:
        self._base = settings.relayer_api_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {settings.relayer_api_key}",
            "Content-Type": "application/json",
        }
        # Vercel function URLs that the Relayer will push results back to.
        self._stream_callback_url = f"{callback_base_url.rstrip('/')}/api/callback/stream"
        self._complete_callback_url = f"{callback_base_url.rstrip('/')}/api/callback/complete"

    async def submit_inference(self, req: InferenceRequest) -> Optional[str]:
        """Submit an AI inference task; returns the task_id or None on error."""
        tier_reqs = MODEL_TIER_REQUIREMENTS[req.model_tier]

        body = TaskSubmissionPayload(
            payload={
                "type": "ai_inference",
                "prompt": req.prompt,
                "model": req.model,
                "telegram_user_id": req.telegram_user_id,
                "chat_id": req.chat_id,
                "message_id": req.message_id,
                "stream_callback_url": self._stream_callback_url,
                "complete_callback_url": self._complete_callback_url,
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

        try:
            async with httpx.AsyncClient(
                headers=self._headers, timeout=DEFAULT_TIMEOUT
            ) as client:
                resp = await client.post(
                    f"{self._base}/api/v1/tasks",
                    json=body.model_dump(),
                )
                if resp.status_code == 201:
                    data: Dict[str, Any] = resp.json()
                    task_id = data.get("task_id")
                    logger.info("Task submitted", extra={"task_id": task_id})
                    return task_id
                else:
                    logger.error(
                        "Relayer rejected task",
                        extra={"status": resp.status_code, "body": resp.text[:200]},
                    )
                    return None
        except httpx.RequestError as e:
            logger.error(f"Network error submitting task: {e}")
            return None

    async def get_task_status(self, task_id: str) -> Optional[TaskStatusResponse]:
        """Poll task status from the Relayer."""
        try:
            async with httpx.AsyncClient(
                headers=self._headers, timeout=DEFAULT_TIMEOUT
            ) as client:
                resp = await client.get(f"{self._base}/api/v1/tasks/{task_id}")
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return TaskStatusResponse.model_validate(resp.json())
        except httpx.RequestError as e:
            logger.warning(f"Error getting task status: {e}")
            return None

    async def list_available_models(self) -> List[Dict[str, Any]]:
        """Ask the relayer which GPU-capable nodes are online and their specs.
        
        Returns a list of dicts with keys:
          - node_id: str
          - gpu: str (GPU description)
          - ram_gb: int
          - supported_tiers: list[str] ("small", "medium", "large")
        """

        def infer_supported_tiers(
            gpu_vram_gb: float,
            ram_gb: int,
            node_tier: str,
        ) -> List[str]:
            """Infer Telegram model tiers from canonical relayer capability fields.

            Preference order:
            1) GPU VRAM (most accurate for model sizing)
            2) Relayer node_tier (basic/pro/premium)
            3) RAM heuristic fallback for legacy nodes
            """
            supported: List[str] = []

            if gpu_vram_gb > 0:
                for tier in ModelTier:
                    reqs = MODEL_TIER_REQUIREMENTS[tier]
                    if gpu_vram_gb >= float(reqs["gpu_vram_gb"]) * 0.9:
                        supported.append(tier.value)
                if not supported and gpu_vram_gb >= 8:
                    supported.append(ModelTier.SMALL.value)
                return supported

            # node_tier comes from relayer schema: basic/pro/premium
            node_tier_lower = (node_tier or "").lower()
            if node_tier_lower == "premium":
                return [ModelTier.SMALL.value, ModelTier.MEDIUM.value, ModelTier.LARGE.value]
            if node_tier_lower == "pro":
                return [ModelTier.SMALL.value, ModelTier.MEDIUM.value]
            if node_tier_lower == "basic":
                return [ModelTier.SMALL.value]

            # Legacy fallback when GPU metadata is missing
            for tier in ModelTier:
                reqs = MODEL_TIER_REQUIREMENTS[tier]
                if ram_gb >= int(reqs["ram_gb"]) * 0.9:
                    supported.append(tier.value)
            if not supported and ram_gb >= 12:
                supported.append(ModelTier.SMALL.value)
            return supported

        try:
            async with httpx.AsyncClient(
                headers=self._headers, timeout=DEFAULT_TIMEOUT
            ) as client:
                resp = await client.get(f"{self._base}/api/v1/nodes")
                if resp.status_code == 200:
                    nodes = resp.json().get("nodes", [])
                    models: List[Dict[str, Any]] = []

                    for node in nodes:
                        hardware = node.get("hardware_spec", {})
                        gpu = hardware.get("gpu_info", "")
                        ram = int(hardware.get("ram_gb", 0) or 0)
                        gpu_vram = float(hardware.get("gpu_vram_gb", 0) or 0)
                        node_tier = str(hardware.get("node_tier", "") or "")

                        # Check if node has GPU capability
                        has_gpu_capability = bool(gpu) or gpu_vram > 0 or ram >= 12
                        # PRO/PREMIUM strongly imply GPU capability
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

                # Fallback to AI capable-nodes endpoint
                ai_resp = await client.get(
                    f"{self._base}/api/v1/ai/capable-nodes"
                )
                if ai_resp.status_code != 200:
                    logger.warning(
                        "Fallback capable-nodes endpoint unavailable",
                        extra={"status_code": ai_resp.status_code},
                    )
                    return []

                fallback_nodes = ai_resp.json()
                models = []
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
        except httpx.RequestError as e:
            logger.error(f"Error listing nodes: {e}")
            return []
