"""Tests for src/models.py — Pydantic model validation and serialization."""

import pytest
from pydantic import ValidationError

from src.models import (
    InferenceRequest,
    ModelTier,
    MODEL_TIER_REQUIREMENTS,
    TaskCallback,
    TaskStatusResponse,
    TaskSubmissionPayload,
)


# ---------------------------------------------------------------------------
# ModelTier enum
# ---------------------------------------------------------------------------


class TestModelTier:
    def test_values(self):
        assert ModelTier.SMALL == "small"
        assert ModelTier.MEDIUM == "medium"
        assert ModelTier.LARGE == "large"

    def test_tier_requirements_complete(self):
        for tier in ModelTier:
            assert tier in MODEL_TIER_REQUIREMENTS
            reqs = MODEL_TIER_REQUIREMENTS[tier]
            assert "ram_gb" in reqs
            assert "gpu_vram_gb" in reqs
            assert "gpu_required" in reqs

    def test_requirements_monotonic(self):
        """Larger tiers should need more resources."""
        small = MODEL_TIER_REQUIREMENTS[ModelTier.SMALL]
        medium = MODEL_TIER_REQUIREMENTS[ModelTier.MEDIUM]
        large = MODEL_TIER_REQUIREMENTS[ModelTier.LARGE]
        assert small["gpu_vram_gb"] < medium["gpu_vram_gb"] < large["gpu_vram_gb"]


# ---------------------------------------------------------------------------
# InferenceRequest
# ---------------------------------------------------------------------------


class TestInferenceRequest:
    def test_valid_request(self):
        req = InferenceRequest(
            telegram_user_id=12345,
            chat_id=67890,
            message_id=111,
            prompt="Hello world",
            model="llama3.1:8b",
            model_tier=ModelTier.SMALL,
            starknet_address="0x04a3",
            cost_strk=100_000_000_000_000_000,
        )
        assert req.telegram_user_id == 12345
        assert req.prompt == "Hello world"
        assert req.model_tier == ModelTier.SMALL

    def test_default_model(self):
        req = InferenceRequest(
            telegram_user_id=1,
            chat_id=2,
            message_id=3,
            prompt="test",
            starknet_address="0xabc",
            cost_strk=100,
        )
        assert req.model == "llama3.1:8b"
        assert req.model_tier == ModelTier.SMALL

    def test_empty_prompt_rejected(self):
        with pytest.raises(ValidationError):
            InferenceRequest(
                telegram_user_id=1,
                chat_id=2,
                message_id=3,
                prompt="",
                starknet_address="0xabc",
                cost_strk=100,
            )

    def test_prompt_max_length(self):
        """Prompt exceeding 4096 chars should be rejected."""
        with pytest.raises(ValidationError):
            InferenceRequest(
                telegram_user_id=1,
                chat_id=2,
                message_id=3,
                prompt="x" * 4097,
                starknet_address="0xabc",
                cost_strk=100,
            )

    def test_prompt_at_max_length(self):
        req = InferenceRequest(
            telegram_user_id=1,
            chat_id=2,
            message_id=3,
            prompt="x" * 4096,
            starknet_address="0xabc",
            cost_strk=100,
        )
        assert len(req.prompt) == 4096

    def test_missing_required_fields(self):
        with pytest.raises(ValidationError):
            InferenceRequest(prompt="test")

    def test_serialization_roundtrip(self):
        req = InferenceRequest(
            telegram_user_id=1,
            chat_id=2,
            message_id=3,
            prompt="test prompt",
            model="llama3.1:70b",
            model_tier=ModelTier.LARGE,
            starknet_address="0xbeef",
            cost_strk=200,
        )
        data = req.model_dump()
        assert data["model_tier"] == "large"
        restored = InferenceRequest.model_validate(data)
        assert restored == req


# ---------------------------------------------------------------------------
# TaskSubmissionPayload
# ---------------------------------------------------------------------------


class TestTaskSubmissionPayload:
    def test_valid_payload(self):
        p = TaskSubmissionPayload(
            payload={"type": "ai_inference", "prompt": "hi"},
            requirements={"cpu_threads": 4, "ram_gb": 16},
            token_amount=1000,
            description="Test task",
        )
        assert p.token_amount == 1000
        assert p.description == "Test task"

    def test_optional_description(self):
        p = TaskSubmissionPayload(
            payload={},
            requirements={},
            token_amount=0,
        )
        assert p.description is None


# ---------------------------------------------------------------------------
# TaskStatusResponse
# ---------------------------------------------------------------------------


class TestTaskStatusResponse:
    def test_completed(self):
        r = TaskStatusResponse(
            task_id="task-123",
            status="completed",
            result={"response": "Hello!"},
            completion_time="2026-03-23T12:00:00Z",
        )
        assert r.status == "completed"
        assert r.result["response"] == "Hello!"

    def test_pending(self):
        r = TaskStatusResponse(task_id="task-456", status="pending")
        assert r.result is None
        assert r.error_message is None

    def test_failed(self):
        r = TaskStatusResponse(
            task_id="task-789", status="failed", error_message="OOM"
        )
        assert r.error_message == "OOM"


# ---------------------------------------------------------------------------
# TaskCallback
# ---------------------------------------------------------------------------


class TestTaskCallback:
    def test_completed_callback(self):
        cb = TaskCallback(
            task_id="t1",
            status="completed",
            result={"response": "output"},
            execution_time=3.14,
        )
        assert cb.status == "completed"
        assert cb.execution_time == 3.14

    def test_failed_callback(self):
        cb = TaskCallback(task_id="t1", status="failed", error="GPU OOM")
        assert cb.error == "GPU OOM"
        assert cb.result is None

    def test_from_json(self):
        raw = b'{"task_id":"t3","status":"completed","result":{"response":"hi"},"execution_time":1.5}'
        cb = TaskCallback.model_validate_json(raw)
        assert cb.task_id == "t3"
        assert cb.execution_time == 1.5

    def test_missing_status(self):
        with pytest.raises(ValidationError):
            TaskCallback(task_id="t1")

    def test_callback_with_routing_fields(self):
        cb = TaskCallback(
            task_id="t1", status="completed",
            chat_id=67890, message_id=999,
        )
        assert cb.chat_id == 67890
        assert cb.message_id == 999

    def test_callback_routing_fields_optional(self):
        cb = TaskCallback(task_id="t1", status="completed")
        assert cb.chat_id is None
        assert cb.message_id is None
