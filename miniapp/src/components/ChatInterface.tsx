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
    <div className="flex flex-col h-full pb-20" style={{ background: 'var(--surface-void)' }}>
      {/* Header with Model Selection */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">Compute</p>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Tasks</h3>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-1.5 h-1.5 bg-[var(--success)] rounded-full animate-breathe" />
              <span className="text-xs font-mono text-[var(--text-muted)]">Online</span>
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
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
            className="flex-1 min-h-[40px] max-h-32 px-4 py-2.5 text-sm rounded-xl resize-none transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-[var(--champagne)] placeholder:text-[var(--text-disabled)]"
            style={{ background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
            rows={1}
          />
          
          <button
            type="submit"
            disabled={!currentMessage.trim() || !selectedModel || isGenerating}
            className="px-4 py-2.5 rounded-xl font-semibold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
            style={{ background: 'var(--champagne)', color: '#000' }}
          >
            {isGenerating ? (
              <div className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} message-fade-in`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
        isUser 
          ? 'bg-[var(--champagne)] text-black' 
          : isSystem
          ? 'text-center px-4 py-2'
          : ''
      }`}
      style={
        isSystem 
          ? { background: 'var(--surface-interactive)', color: 'var(--text-muted)' }
          : !isUser 
          ? { background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' } 
          : undefined
      }>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        
        {message.imageUrl && (
          <div className="mt-2">
            <img 
              src={message.imageUrl} 
              alt="Generated content" 
              className="rounded-xl max-w-full h-auto"
            />
            {message.nftMintable && (
              <button
                onClick={() => onMintNFT(message.imageUrl!)}
                className="mt-2 w-full px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
                style={{ background: 'var(--cyan)', color: '#000' }}
              >
                Mint as NFT
              </button>
            )}
          </div>
        )}
        
        <div className={`text-[10px] font-mono mt-1 ${isUser ? 'text-black/50' : 'text-[var(--text-disabled)]'}`}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
