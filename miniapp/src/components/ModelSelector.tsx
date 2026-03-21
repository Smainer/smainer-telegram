import React from 'react';
import type { AIModel } from '@/types';

interface ModelSelectorProps {
  models: AIModel[];
  selectedModel: AIModel | null;
  onSelectModel: (model: AIModel) => void;
}

export function ModelSelector({ models, selectedModel, onSelectModel }: ModelSelectorProps) {
  if (models.length === 0) {
    return (
      <div className="glass p-4 text-center">
        <p className="text-sm text-[var(--text-muted)]">No compute nodes online</p>
        <p className="text-xs text-[var(--text-hint)] mt-1">Connect a provider to start</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Horizontal scrollable pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {models.map((model) => {
          const isSelected = selectedModel?.name === model.name;
          return (
            <button
              key={model.name}
              onClick={() => onSelectModel(model)}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-[var(--blue)] border-[var(--blue)] text-white'
                  : 'bg-[var(--surface-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-card-hover)]'
              }`}
            >
              <ModelIcon type={model.type} isActive={isSelected} />
              <div className="text-left">
                <p className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}`}>
                  {model.display_name}
                </p>
                <p className={`text-[11px] ${isSelected ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                  {model.vram_required}GB • ${model.cost_per_token.toFixed(5)}/tok
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Gradient fade on right edge */}
      {models.length > 2 && (
        <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-[var(--void)] to-transparent pointer-events-none" />
      )}
    </div>
  );
}

function ModelIcon({ type, isActive }: { type: string; isActive: boolean }) {
  const color = isActive ? 'white' : 'var(--text-muted)';
  
  switch (type.toLowerCase()) {
    case 'text':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="4" width="14" height="10" rx="2" stroke={color} strokeWidth="1.5" />
          <path d="M5 8H11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5 11H9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'image':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="3" width="14" height="12" rx="2" stroke={color} strokeWidth="1.5" />
          <circle cx="6" cy="7" r="1.5" fill={color} />
          <path d="M2 12L6 9L9 11L14 7L16 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'multimodal':
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="2" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.5" />
          <rect x="10" y="2" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.5" />
          <rect x="2" y="10" width="6" height="6" rx="1.5" stroke={color} strokeWidth="1.5" />
          <rect x="10" y="10" width="6" height="6" rx="1.5" fill={isActive ? 'white' : 'var(--blue)'} />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="1.5" />
          <circle cx="9" cy="9" r="2" fill={color} />
        </svg>
      );
  }
}
