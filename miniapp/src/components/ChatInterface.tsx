import React, { useState, useRef, useEffect } from 'react';
import type { AIModel, InferenceRequest, InferenceTaskStatus } from '@/types';
import { ModelSelector } from './ModelSelector';
import { NFTPreview } from './NFTPreview';

interface ChatInterfaceProps {
  walletAddress: string;
  availableModels: AIModel[];
  onSubmitTask: (task: InferenceRequest) => Promise<string>;
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
  isLoading?: boolean;
}

export function ChatInterface({ 
  walletAddress, 
  availableModels, 
  onSubmitTask, 
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(
    availableModels.length > 0 ? availableModels[0] : null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [showNFTPreview, setShowNFTPreview] = useState(false);
  const [selectedImageForNFT, setSelectedImageForNFT] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-select first model when available
  useEffect(() => {
    if (!selectedModel && availableModels.length > 0) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

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

    const loadingId = `loading-${Date.now()}`;
    const loadingMessage: ChatMessage = {
      id: loadingId,
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setCurrentMessage('');
    setIsGenerating(true);

    try {
      const inferenceRequest: InferenceRequest = {
        model_name: selectedModel.name,
        prompt: currentMessage,
        max_tokens: 512,
        temperature: 0.7,
        metadata: {
          user_address: walletAddress,
          session_id: Date.now().toString(),
        }
      };

      const taskId = await onSubmitTask(inferenceRequest);

      // Simulate streaming response (replace with real WebSocket/SSE in production)
      const isImageGeneration = currentMessage.toLowerCase().includes('image') || 
                                currentMessage.toLowerCase().includes('picture') ||
                                currentMessage.toLowerCase().includes('generate');
      
      const responseContent = isImageGeneration 
        ? 'Image generation task submitted. Results will appear here when the compute node responds.'
        : `Task ${taskId.slice(0, 8)}... submitted to compute network. Waiting for GPU response...`;
      
      // Simulate typing effect
      let charIndex = 0;
      const typeInterval = setInterval(() => {
        charIndex += 3;
        if (charIndex >= responseContent.length) {
          clearInterval(typeInterval);
          setMessages(prev => prev.map(m => 
            m.id === loadingId 
              ? { ...m, content: responseContent, isLoading: false, taskId, nftMintable: isImageGeneration }
              : m
          ));
          setIsGenerating(false);
        } else {
          setMessages(prev => prev.map(m => 
            m.id === loadingId 
              ? { ...m, content: responseContent.slice(0, charIndex) }
              : m
          ));
        }
      }, 30);

    } catch (error) {
      console.error('Failed to submit task:', error);
      
      setMessages(prev => prev.map(m => 
        m.id === loadingId 
          ? { 
              ...m, 
              type: 'system' as const, 
              content: 'Task failed. Please check your connection and try again.', 
              isLoading: false 
            }
          : m
      ));
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const wordCount = currentMessage.trim().split(/\s+/).filter(Boolean).length;
  const estimatedTokens = wordCount * 2;
  const estimatedCost = selectedModel ? (estimatedTokens * selectedModel.cost_per_token).toFixed(6) : '0';

  return (
    <div className="flex flex-col h-full bg-[var(--void)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-label">Compute</p>
            <h3 className="text-xl font-semibold text-white">AI Tasks</h3>
          </div>
          <div className="status">
            <div className="status-dot status-dot-online animate-glow" />
            <span className="text-sm text-[var(--text-muted)]">Ready</span>
          </div>
        </div>
        
        {/* Model Selector Pills */}
        <ModelSelector
          models={availableModels}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ paddingBottom: '180px' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 animate-in">
            <div className="w-16 h-16 rounded-3xl bg-[var(--surface-glass)] flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="8" width="24" height="16" rx="3" stroke="var(--text-muted)" strokeWidth="2" />
                <path d="M8 14H18" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 18H14" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="24" cy="16" r="3" fill="var(--blue)" />
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-white mb-2">Private Compute</h4>
            <p className="text-sm text-[var(--text-muted)] max-w-[240px]">
              Send tasks to GPU nodes on the Starknet network. Your data stays private.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onMintNFT={(url) => {
              setSelectedImageForNFT(url);
              setShowNFTPreview(true);
            }}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="fixed bottom-[72px] left-0 right-0 bg-[var(--void)] border-t border-[var(--border-subtle)] px-5 py-4 safe-area-bottom">
        {/* Cost Estimate */}
        {selectedModel && currentMessage.trim() && (
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-[var(--text-muted)]">~{estimatedTokens} tokens</span>
            <span className="text-[var(--blue)] font-medium">{estimatedCost} STRK</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-3">
          <textarea
            ref={inputRef}
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedModel ? "Describe your task..." : "Select a model above"}
            disabled={!selectedModel || isGenerating}
            className="input flex-1 min-h-[52px] max-h-32 resize-none"
            rows={1}
          />
          
          <button
            type="submit"
            disabled={!currentMessage.trim() || !selectedModel || isGenerating}
            className="btn btn-icon btn-primary"
          >
            {isGenerating ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 10L10 3L17 10M10 3V17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-45 10 10)" />
              </svg>
            )}
          </button>
        </form>

        {!selectedModel && availableModels.length === 0 && (
          <p className="mt-3 text-sm text-center text-[var(--warning)]">
            No compute nodes online. Connect a provider to start.
          </p>
        )}
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
            console.log('Minting NFT:', metadata);
            setShowNFTPreview(false);
            setSelectedImageForNFT(null);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE BUBBLE
   ═══════════════════════════════════════════════════════════════════════════ */

interface MessageBubbleProps {
  message: ChatMessage;
  onMintNFT: (imageUrl: string) => void;
}

function MessageBubble({ message, onMintNFT }: MessageBubbleProps) {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';
  const isLoading = message.isLoading;

  if (isSystem) {
    return (
      <div className="flex justify-center animate-in">
        <div className="pill pill-warning">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in`}>
      <div className={`max-w-[85%] px-4 py-3 ${
        isUser 
          ? 'message-user' 
          : 'message-assistant'
      }`}>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-[var(--blue)] rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[var(--blue)] rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-2 h-2 bg-[var(--blue)] rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
            
            {message.imageUrl && (
              <div className="mt-3">
                <img 
                  src={message.imageUrl} 
                  alt="Generated content" 
                  className="rounded-xl max-w-full h-auto"
                />
                {message.nftMintable && (
                  <button
                    onClick={() => onMintNFT(message.imageUrl!)}
                    className="mt-3 btn btn-primary w-full text-sm"
                  >
                    Mint as NFT
                  </button>
                )}
              </div>
            )}
          </>
        )}
        
        {!isLoading && (
          <p className={`text-[11px] mt-2 ${isUser ? 'text-white/50' : 'text-[var(--text-hint)]'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  );
}
