'use client';

import { useState, useEffect, useCallback } from 'react';
import type { 
  AIModel, 
  InferenceRequest, 
  InferenceTaskStatus
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

  useEffect(() => {
    fetchAvailableModels();
  }, []);

  const buildHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = (import.meta as any).env?.VITE_RELAYER_API_KEY as string | undefined;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }, []);

  const mapTaskStatus = (rawStatus: string): InferenceTaskStatus['status'] => {
    if (rawStatus === 'completed') return 'completed';
    if (rawStatus === 'failed' || rawStatus === 'timeout') return 'failed';
    return 'processing';
  };

  const fetchAvailableModels = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`${config.baseUrl}/api/v1/ai/capable-nodes`, {
        headers: buildHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch models: HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setIsConnected(true);
      
      // Transform backend response to our model format
      const models: AIModel[] = (Array.isArray(data) ? data : []).map((node: any) => ({
        name: node.gpu || 'GPU Node',
        display_name: node.gpu || 'GPU Node',
        type: 'text',
        description: `Node ${String(node.node_id || '').slice(0, 8)}...`,
        vram_required: Number(node.vram_gb || 8),
        cost_per_token: 0.000001,
        capabilities: ['text-generation'],
        provider_count: 1,
      })) || [];
      
      setAvailableModels(models);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setIsConnected(false);
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
        payload: {
          type: 'ai_inference',
          prompt: request.prompt,
          model: request.model_name,
          user_address: config.walletAddress,
        },
        requirements: {
          cpu_threads: 4,
          ram_gb: 16,
          gpu_required: true,
          max_execution_time: 300,
        },
        token_amount: 1,
        description: `Telegram miniapp inference (${request.model_name})`,
      };

      const response = await fetch(`${config.baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let reason = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          reason = errorData.detail || errorData.error || reason;
        } catch {
          // keep status-only reason for non-JSON responses
        }
        throw new Error(reason);
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

    const interval = setInterval(async () => {
      try {
        const status = await getTaskStatus(taskId);
        onUpdate(status);
      } catch {
        // getTaskStatus already records error state
      }
    }, 3000);

    // Return unsubscribe function
    return () => {
      setTaskSubscriptions(prev => prev.filter(sub => sub.taskId !== taskId));
      clearInterval(interval);
    };
  }, [buildHeaders, config.baseUrl]);

  const getTaskStatus = async (taskId: string): Promise<InferenceTaskStatus> => {
    try {
      const response = await fetch(`${config.baseUrl}/api/v1/tasks/${taskId}`, {
        headers: buildHeaders(),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get task status: ${response.statusText}`);
      }
      
      const data = await response.json();
      return {
        task_id: data.task_id,
        status: mapTaskStatus(data.status),
        result: data.result?.response,
        error: data.error_message,
        execution_time: data.result?.execution_time,
        node_id: data.assigned_node_id,
      };
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get task status';
      setError(errorMessage);
      throw err;
    }
  };

  const getProviderStats = async () => {
    try {
      const response = await fetch(`${config.baseUrl}/api/v1/nodes`, {
        headers: buildHeaders(),
      });
      
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
    reconnect: fetchAvailableModels,
  };
}