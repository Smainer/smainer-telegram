"""HTTP client for the Smainer Relayer REST API."""

import logging
from typing import Any, Dict, Optional

import httpx

from .config import settings
from .models import (
    InferenceRequest,
    ModelTier,
    MODEL_TIER_REQUIREMENTS,
    TaskStatusResponse,
    TaskSubmissionPayload,
)

logger = logging.getLogger(__name__)


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
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{self._base}/api/v1/tasks/{task_id}",
                headers=self._headers,
            )
            if resp.status_code == 200:
                return TaskStatusResponse.model_validate(resp.json())
            return None

    # ------------------------------------------------------------------
    # Node discovery (for /models command)
    # ------------------------------------------------------------------

    async def list_available_models(self) -> list[Dict[str, Any]]:
        """Ask the relayer which GPU-capable nodes are online and their specs."""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{self._base}/api/v1/nodes",
                headers=self._headers,
            )
            if resp.status_code != 200:
                return []

            nodes = resp.json().get("nodes", [])
            models: list[Dict[str, Any]] = []

            for node in nodes:
                gpu = node.get("hardware_spec", {}).get("gpu_info", "")
                ram = node.get("hardware_spec", {}).get("ram_gb", 0)
                if not gpu:
                    continue

                # Infer supported tiers from RAM/GPU
                supported: list[str] = []
                for tier in ModelTier:
                    reqs = MODEL_TIER_REQUIREMENTS[tier]
                    if ram >= reqs["ram_gb"]:
                        supported.append(tier.value)

                models.append(
                    {
                        "node_id": node["node_id"],
                        "gpu": gpu,
                        "ram_gb": ram,
                        "supported_tiers": supported,
                    }
                )
            return models
