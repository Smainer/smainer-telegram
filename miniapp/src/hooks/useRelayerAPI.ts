'use client';

import { useState, useEffect, useCallback } from 'react';
import type { 
  AIModel, 
  InferenceRequest, 
  InferenceResponse, 
  InferenceTaskStatus,
  ConnectedWallet 
} from '@/types';

interface RelayerAPIConfig {
  baseUrl: string;
  walletAddress?: string;
}

interface TaskSubscription {
  taskId: string;
  onUpdate: (status: InferenceTaskStatus) => void;
}

export function useRelayerAPI(config: RelayerAPIConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskSubscriptions, setTaskSubscriptions] = useState<TaskSubscription[]>([]);

  // WebSocket connection for real-time updates
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Initialize WebSocket connection when component mounts
    const wsUrl = config.baseUrl.replace('http', 'ws') + '/ws';
    
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      console.log('WebSocket connected to relayer');
      setIsConnected(true);
    };
    
    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    websocket.onclose = () => {
      console.log('WebSocket disconnected from relayer');
      setIsConnected(false);
      
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        setWs(new WebSocket(wsUrl));
      }, 3000);
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection to relayer failed');
    };

    setWs(websocket);

    // Cleanup on unmount
    return () => {
      websocket.close();
    };
  }, [config.baseUrl]);

  useEffect(() => {
    // Fetch available models when component mounts
    fetchAvailableModels();
  }, []);

  const handleWebSocketMessage = (data: any) => {
    if (data.type === 'task_update') {
      const { task_id, status } = data;
      
      // Find subscription and call callback
      const subscription = taskSubscriptions.find(sub => sub.taskId === task_id);
      if (subscription) {
        subscription.onUpdate(status);
      }
    }
  };

  const fetchAvailableModels = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${config.baseUrl}/api/ai-inference/capable-nodes`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Transform backend response to our model format
      const models: AIModel[] = data.available_models?.map((model: any) => ({
        name: model.name,
        display_name: model.display_name || model.name,
        type: model.type || 'text',
        description: model.description || 'AI language model',
        vram_required: model.vram_required || 8,
        cost_per_token: model.cost_per_token || 0.000001,
        capabilities: model.capabilities || [],
        provider_count: model.provider_count || 0
      })) || [];
      
      setAvailableModels(models);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Failed to fetch available models:', err);
    } finally {
      setLoading(false);
    }
  };

  const submitInferenceTask = async (request: InferenceRequest): Promise<string> => {
    try {
      setError(null);
      
      if (!config.walletAddress) {
        throw new Error('Wallet address is required');
      }

      const requestBody = {
        ...request,
        user_address: config.walletAddress,
      };

      const response = await fetch(`${config.baseUrl}/api/ai-inference/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication header if needed
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.task_id;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit task';
      setError(errorMessage);
      throw err;
    }
  };

  const subscribeToTaskUpdates = useCallback((
    taskId: string, 
    onUpdate: (status: InferenceTaskStatus) => void
  ) => {
    setTaskSubscriptions(prev => [
      ...prev.filter(sub => sub.taskId !== taskId), // Remove existing subscription
      { taskId, onUpdate }
    ]);

    // Send subscription message via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe_task',
        task_id: taskId
      }));
    }

    // Return unsubscribe function
    return () => {
      setTaskSubscriptions(prev => prev.filter(sub => sub.taskId !== taskId));
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'unsubscribe_task',
          task_id: taskId
        }));
      }
    };
  }, [ws]);

  const getTaskStatus = async (taskId: string): Promise<InferenceTaskStatus> => {
    try {
      const response = await fetch(`${config.baseUrl}/api/ai-inference/status/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get task status: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get task status';
      setError(errorMessage);
      throw err;
    }
  };

  const getProviderStats = async () => {
    try {
      const response = await fetch(`${config.baseUrl}/api/provider-stats`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch provider stats: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (err) {
      console.error('Failed to fetch provider stats:', err);
      return null;
    }
  };

  return {
    // Connection state
    isConnected,
    loading,
    error,
    
    // Data
    availableModels,
    
    // Actions
    submitInferenceTask,
    subscribeToTaskUpdates,
    getTaskStatus,
    getProviderStats,
    refetchModels: fetchAvailableModels,
    
    // Connection management
    reconnect: () => {
      if (ws) {
        ws.close();
      }
    }
  };
}