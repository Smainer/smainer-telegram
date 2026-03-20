'use client';

import React, { useState } from 'react';
import type { AIModel } from '@/types';

interface ModelSelectorProps {
  models: AIModel[];
  selectedModel: AIModel | null;
  onSelectModel: (model: AIModel) => void;
}

export function ModelSelector({ models, selectedModel, onSelectModel }: ModelSelectorProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const getModelTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'text':
        return 'TXT';
      case 'image':
        return 'IMG';
      case 'multimodal':
        return 'MUL';
      default:
        return 'AI';
    }
  };

  const getVRAMColor = (vram: number) => {
    if (vram <= 8) return 'text-green-600 bg-green-50';
    if (vram <= 16) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="w-full flex items-center justify-between px-3 py-2 border border-input bg-background rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <div className="flex items-center space-x-2">
          {selectedModel ? (
            <>
              <span className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">{getModelTypeIcon(selectedModel.type)}</span>
              <div className="text-left">
                <div className="font-medium text-sm">{selectedModel.display_name}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedModel.vram_required}GB VRAM • ${selectedModel.cost_per_token.toFixed(6)}/token
                </div>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">Choose Compute Model...</span>
          )}
        </div>
        
        <svg
          className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isDropdownOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md z-50 max-h-64 overflow-y-auto">
          <div className="p-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-2">
              Available Models
            </div>
            
            {models.length === 0 ? (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                No compute nodes online. Try again in 2 minutes.
              </div>
            ) : (
              <div className="space-y-1">
                {models.map((model) => (
                  <ModelOption
                    key={model.name}
                    model={model}
                    isSelected={selectedModel?.name === model.name}
                    onClick={() => {
                      onSelectModel(model);
                      setIsDropdownOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelOptionProps {
  model: AIModel;
  isSelected: boolean;
  onClick: () => void;
}

function ModelOption({ model, isSelected, onClick }: ModelOptionProps) {
  const getModelTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'text':
        return 'TXT';
      case 'image':
        return 'IMG';
      case 'multimodal':
        return 'MUL';
      default:
        return 'AI';
    }
  };

  const getVRAMColor = (vram: number) => {
    if (vram <= 8) return 'text-green-600 bg-green-50';
    if (vram <= 16) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getPerformanceLevel = (vram: number) => {
    if (vram <= 8) return 'Efficient';
    if (vram <= 16) return 'Balanced';
    return 'High-End';
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 text-left rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${
        isSelected ? 'bg-accent text-accent-foreground' : ''
      }`}
    >
      <div className="flex items-start space-x-3">
        <div className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded mt-0.5">{getModelTypeIcon(model.type)}</div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm truncate">{model.display_name}</h4>
            {isSelected && (
              <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center ml-2">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
          
          <div className="text-xs text-muted-foreground mt-1">
            {model.description}
          </div>
          
          <div className="flex items-center space-x-2 mt-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getVRAMColor(model.vram_required)}`}>
              {model.vram_required}GB VRAM
            </span>
            
            <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs">
              {getPerformanceLevel(model.vram_required)}
            </span>
            
            <span className="text-xs text-muted-foreground">
              ${model.cost_per_token.toFixed(6)}/token
            </span>
          </div>
          
          {model.capabilities && model.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {model.capabilities.map((capability, index) => (
                <span
                  key={index}
                  className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded"
                >
                  {capability}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}