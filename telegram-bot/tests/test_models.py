"""Tests for model tier inference and models schema."""

import pytest

from telegram_bot.handlers import SmainerBot
from telegram_bot.models import (
    InferenceRequest,
    ModelTier,
    MODEL_TIER_REQUIREMENTS,
    StreamChunk,
    TaskCallback,
)


class TestModelTierInference:
    def test_small_models(self):
        assert SmainerBot._infer_tier("llama3.1:8b") == ModelTier.SMALL
        assert SmainerBot._infer_tier("mistral:7b") == ModelTier.SMALL

    def test_medium_models(self):
        assert SmainerBot._infer_tier("codellama:34b") == ModelTier.MEDIUM
        assert SmainerBot._infer_tier("llama2:13b") == ModelTier.MEDIUM

    def test_large_models(self):
        assert SmainerBot._infer_tier("llama3.1:70b") == ModelTier.LARGE
        assert SmainerBot._infer_tier("qwen:72b") == ModelTier.LARGE

    def test_unknown_defaults_to_small(self):
        assert SmainerBot._infer_tier("some-custom-model") == ModelTier.SMALL


class TestModels:
    def test_tier_requirements_exist(self):
        for tier in ModelTier:
            reqs = MODEL_TIER_REQUIREMENTS[tier]
            assert "ram_gb" in reqs
            assert "gpu_required" in reqs

    def test_stream_chunk_validation(self):
        chunk = StreamChunk(task_id="t1", chunk="hello", done=False)
        assert chunk.task_id == "t1"

    def test_task_callback_completed(self):
        cb = TaskCallback(
            task_id="t1",
            status="completed",
            result={"response": "hi"},
            execution_time=1.5,
        )
        assert cb.status == "completed"

    def test_inference_request_validation(self):
        req = InferenceRequest(
            telegram_user_id=1,
            chat_id=1,
            message_id=1,
            prompt="Hello",
            starknet_address="0xabc",
            cost_strk=100,
        )
        assert req.model == "llama3.1:8b"
        assert req.model_tier == ModelTier.SMALL
