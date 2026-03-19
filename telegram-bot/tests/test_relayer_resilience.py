"""Tests for resilient node availability logic in relayer client."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from telegram_bot.models import ModelTier
from telegram_bot.relayer_client import RelayerClient


class TestRelayerClientResilience:
    """Test resilient node availability detection."""
    
    @pytest.fixture
    def relayer_client(self):
        """Create test relayer client."""
        return RelayerClient("http://test-callback-url")

    @pytest.mark.asyncio
    async def test_list_available_models_missing_gpu_info(self, relayer_client):
        """Test that nodes without gpu_info are still included if they have sufficient RAM."""
        mock_response_data = {
            "nodes": [
                {
                    "node_id": "node-1",
                    "hardware_spec": {
                        # Missing gpu_info but has good RAM
                        "ram_gb": 32,
                        "cpu_threads": 8
                    }
                },
                {
                    "node_id": "node-2", 
                    "hardware_spec": {
                        "gpu_info": "RTX 4090 24GB",
                        "ram_gb": 24,
                        "cpu_threads": 12
                    }
                },
                {
                    "node_id": "node-3",
                    "hardware_spec": {
                        # Low RAM and no GPU info - should be excluded
                        "ram_gb": 8,
                        "cpu_threads": 4
                    }
                }
            ]
        }
        
        with patch("httpx.AsyncClient") as mock_client_class:
            # Create mock client instance  
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            # Mock the get method and response (use regular Mock for response since json() is sync)
            from unittest.mock import Mock
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_response_data
            mock_client.get.return_value = mock_response

            models = await relayer_client.list_available_models()
            
            # Should include node-1 (missing GPU but sufficient RAM) and node-2 (has GPU)
            # Should exclude node-3 (low RAM and no GPU)
            assert len(models) == 2
            
            node_ids = {model["node_id"] for model in models}
            assert "node-1" in node_ids
            assert "node-2" in node_ids
            assert "node-3" not in node_ids
            
            # Check fallback GPU description for node-1
            node_1 = next(m for m in models if m["node_id"] == "node-1")
            assert "Unknown GPU" in node_1["gpu"]
            assert "32GB" in node_1["gpu"]

    @pytest.mark.asyncio
    async def test_tier_matching_with_tolerance(self, relayer_client):
        """Test that tier matching allows 10% tolerance for RAM requirements."""
        mock_response_data = {
            "nodes": [
                {
                    "node_id": "barely-sufficient",
                    "hardware_spec": {
                        "gpu_info": "GTX 1080", 
                        # 15GB RAM - 10% below SMALL tier requirement (16GB)
                        "ram_gb": 15,
                        "cpu_threads": 4
                    }
                },
                {
                    "node_id": "well-above",
                    "hardware_spec": {
                        "gpu_info": "RTX 4090",
                        "ram_gb": 64,
                        "cpu_threads": 16
                    }
                }
            ]
        }
        
        with patch("httpx.AsyncClient") as mock_client_class:
            # Create mock client instance  
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            # Mock the get method and response
            from unittest.mock import Mock
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_response_data  
            mock_client.get.return_value = mock_response

            models = await relayer_client.list_available_models()
            
            assert len(models) == 2
            
            # Barely sufficient node should support SMALL tier due to 10% tolerance
            barely_sufficient = next(m for m in models if m["node_id"] == "barely-sufficient")
            assert ModelTier.SMALL.value in barely_sufficient["supported_tiers"]
            
            # Well-above node should support multiple tiers
            well_above = next(m for m in models if m["node_id"] == "well-above")
            supported_tiers = well_above["supported_tiers"]
            assert ModelTier.SMALL.value in supported_tiers
            assert ModelTier.MEDIUM.value in supported_tiers
            assert ModelTier.LARGE.value in supported_tiers

    @pytest.mark.asyncio 
    async def test_fallback_tier_assignment(self, relayer_client):
        """Test that nodes with reasonable RAM get SMALL tier as fallback."""
        mock_response_data = {
            "nodes": [
                {
                    "node_id": "edge-case-node",
                    "hardware_spec": {
                        # No GPU info, RAM below all tier requirements but reasonable
                        "ram_gb": 13,  # Below 14.4GB (90% of SMALL requirement)
                        "cpu_threads": 2
                    }
                }
            ]
        }
        
        with patch("httpx.AsyncClient") as mock_client_class:
            # Create mock client instance  
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            # Mock the get method and response
            from unittest.mock import Mock
            mock_response = Mock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_response_data  
            mock_client.get.return_value = mock_response

            models = await relayer_client.list_available_models()
            
            assert len(models) == 1
            
            edge_case_node = models[0]
            assert edge_case_node["node_id"] == "edge-case-node"
            # Should get SMALL tier as fallback since RAM >= 12GB
            assert ModelTier.SMALL.value in edge_case_node["supported_tiers"]

    @pytest.mark.asyncio
    async def test_very_low_ram_excluded(self, relayer_client):
        """Test that nodes with very low RAM are excluded even from fallback."""
        mock_response_data = {
            "nodes": [
                {
                    "node_id": "very-low-ram",
                    "hardware_spec": {
                        "ram_gb": 4,  # Too low even for fallback
                        "cpu_threads": 2
                    }
                }
            ]
        }
        
        with patch("httpx.AsyncClient.get") as mock_get:
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_response_data  
            mock_get.return_value.__aenter__.return_value = mock_response

            models = await relayer_client.list_available_models()
            
            # Should be excluded due to insufficient RAM for any capability
            assert len(models) == 0

    @pytest.mark.asyncio
    async def test_api_error_handling(self, relayer_client):
        """Test graceful handling of API errors."""
        with patch("httpx.AsyncClient") as mock_client_class:
            # Create mock client instance  
            mock_client = AsyncMock()
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            # Mock the get method and response
            from unittest.mock import Mock
            mock_response = Mock()
            mock_response.status_code = 500  # API error
            mock_client.get.return_value = mock_response

            models = await relayer_client.list_available_models()
            
            # Should return empty list instead of crashing
            assert models == []