'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { AIModel, InferenceRequest, InferenceResponse, InferenceTaskStatus } from '@/types';
import { ModelSelector } from './ModelSelector';
import { CostEstimator } from './CostEstimator';
import { NFTPreview } from './NFTPreview';

interface ChatInterfaceProps {
  walletAddress: string;
  availableModels: AIModel[];
  onSubmitTask: (task: InferenceRequest) => Promise<string>; // Returns task ID
  onTaskUpdate?: (taskId: string, status: InferenceTaskStatus) => void;
}

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  taskId?: string;
  nftMintable?: boolean;
  imageUrl?: string;
}

export function ChatInterface({ 
  walletAddress, 
  availableModels, 
  onSubmitTask, 
  onTaskUpdate 
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'system',
      content: 'Private compute on Starknet. Select model and submit tasks.',
      timestamp: new Date(),
    }
  ]);
  
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showNFTPreview, setShowNFTPreview] = useState(false);
  const [selectedImageForNFT, setSelectedImageForNFT] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentMessage.trim() || !selectedModel || isGenerating) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: currentMessage,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentMessage('');
    setIsGenerating(true);

    const loadingId = `loading-${Date.now()}`;

    try {
      const inferenceRequest: InferenceRequest = {
        model_name: selectedModel.name,
        prompt: currentMessage,
        max_tokens: 150,
        temperature: 0.7,
        metadata: {
          user_address: walletAddress,
          session_id: Date.now().toString(),
        }
      };

      const taskId = await onSubmitTask(inferenceRequest);
      setActiveTaskId(taskId);

      // Add loading message
      const loadingMessage: ChatMessage = {
        id: loadingId,
        type: 'assistant',
        content: 'Running computation...',
        timestamp: new Date(),
        taskId,
      };

      setMessages(prev => [...prev, loadingMessage]);

      // Demo response — replace with real task polling in production
      setTimeout(() => {
        const isImageGeneration = currentMessage.toLowerCase().includes('image') || 
                                currentMessage.toLowerCase().includes('picture') ||
                                currentMessage.toLowerCase().includes('generate');
        
        const responseContent = isImageGeneration 
          ? '[Demo] Generated image result:'
          : `[Demo] Task ${taskId.slice(0, 8)}... completed. Live results require an active compute node.`;
        
        const responseMessage: ChatMessage = {
          id: `response-${Date.now()}`,
          type: 'assistant',
          content: responseContent,
          timestamp: new Date(),
          taskId,
          nftMintable: isImageGeneration,
          imageUrl: isImageGeneration ? '/api/placeholder-image.jpg' : undefined,
        };

        setMessages(prev => prev.filter(m => m.id !== loadingId).concat(responseMessage));
        setIsGenerating(false);
        setActiveTaskId(null);
      }, 3000);

    } catch (error) {
      console.error('Failed to submit task:', error);
      
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        type: 'system',
        content: 'Compute failed. Check model selection and try again.',
        timestamp: new Date(),
      };

      setMessages(prev => prev.filter(m => m.id !== loadingId).concat(errorMessage));
      setIsGenerating(false);
      setActiveTaskId(null);
    }
  };

  const handleMintNFT = (imageUrl: string) => {
    setSelectedImageForNFT(imageUrl);
    setShowNFTPreview(true);
  };

  return (
    <div className="flex flex-col h-full max-h-screen">
      {/* Header with Model Selection */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4">
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Compute Tasks</h3>
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>Connected</span>
            </div>
          </div>
          
          <ModelSelector
            models={availableModels}
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
          />
          
          {selectedModel && (
            <CostEstimator
              model={selectedModel}
              estimatedTokens={currentMessage.split(' ').length * 2}
            />
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onMintNFT={handleMintNFT}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-background/95 backdrop-blur p-4">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <textarea
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={selectedModel ? "Describe your compute task..." : "Choose compute model above"}
            disabled={!selectedModel || isGenerating}
            className="flex-1 min-h-[40px] max-h-32 px-4 py-2 text-sm bg-background border border-input rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            rows={1}
          />
          
          <button
            type="submit"
            disabled={!currentMessage.trim() || !selectedModel || isGenerating}
            className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center space-x-2"
          >
            {isGenerating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </form>
      </div>

      {/* NFT Preview Modal */}
      {showNFTPreview && selectedImageForNFT && (
        <NFTPreview
          imageUrl={selectedImageForNFT}
          onClose={() => {
            setShowNFTPreview(false);
            setSelectedImageForNFT(null);
          }}
          onMint={(metadata) => {
            console.log('Minting NFT with metadata:', metadata);
            // TODO: Implement actual NFT minting
            setShowNFTPreview(false);
            setSelectedImageForNFT(null);
          }}
        />
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  onMintNFT: (imageUrl: string) => void;
}

function MessageBubble({ message, onMintNFT }: MessageBubbleProps) {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
        isUser 
          ? 'bg-primary text-primary-foreground' 
          : isSystem
          ? 'bg-muted text-muted-foreground text-center'
          : 'bg-card border'
      }`}>
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        
        {message.imageUrl && (
          <div className="mt-2">
            <img 
              src={message.imageUrl} 
              alt="Generated content" 
              className="rounded-lg max-w-full h-auto"
            />
            {message.nftMintable && (
              <button
                onClick={() => onMintNFT(message.imageUrl!)}
                className="mt-2 w-full px-3 py-1 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold text-xs rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Mint as NFT
              </button>
            )}
          </div>
        )}
        
        <div className="text-xs mt-1 opacity-70">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}