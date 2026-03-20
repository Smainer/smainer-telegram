'use client';

import React, { useState } from 'react';

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string;
  }>;
}

interface NFTPreviewProps {
  imageUrl: string;
  onClose: () => void;
  onMint: (metadata: NFTMetadata) => void;
}

export function NFTPreview({ imageUrl, onClose, onMint }: NFTPreviewProps) {
  const [nftName, setNftName] = useState('');
  const [nftDescription, setNftDescription] = useState('');
  const [isMinting, setIsMinting] = useState(false);

  const handleMint = async () => {
    if (!nftName.trim() || !nftDescription.trim()) return;

    setIsMinting(true);

    try {
      const metadata: NFTMetadata = {
        name: nftName,
        description: nftDescription,
        image: imageUrl,
        attributes: [
          { trait_type: 'Generation Method', value: 'Smainer AI' },
          { trait_type: 'Created At', value: new Date().toISOString().split('T')[0] },
          { trait_type: 'Network', value: 'Starknet' }
        ]
      };

      await onMint(metadata);
    } catch (error) {
      console.error('Failed to mint NFT:', error);
    } finally {
      setIsMinting(false);
    }
  };

  const canMint = nftName.trim() && nftDescription.trim() && !isMinting;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--surface-card)] border-b border-[var(--border-subtle)] p-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Mint as NFT</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--surface-interactive)] rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Image Preview */}
          <div className="aspect-square rounded-xl overflow-hidden bg-[var(--surface-interactive)] border border-[var(--border-subtle)]">
            <img 
              src={imageUrl} 
              alt="NFT Preview" 
              className="w-full h-full object-cover"
            />
          </div>

          {/* Form */}
          <div className="space-y-4">
            {/* Name Input */}
            <div>
              <label htmlFor="nft-name" className="block text-sm font-medium text-white mb-2">
                NFT Name
              </label>
              <input
                id="nft-name"
                type="text"
                value={nftName}
                onChange={(e) => setNftName(e.target.value)}
                placeholder="Enter a name for your NFT"
                className="input-field"
                maxLength={50}
              />
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                {nftName.length}/50 characters
              </div>
            </div>

            {/* Description Input */}
            <div>
              <label htmlFor="nft-description" className="block text-sm font-medium text-white mb-2">
                Description
              </label>
              <textarea
                id="nft-description"
                value={nftDescription}
                onChange={(e) => setNftDescription(e.target.value)}
                placeholder="Describe this AI-generated artwork..."
                className="input-field resize-none"
                rows={3}
                maxLength={200}
              />
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                {nftDescription.length}/200 characters
              </div>
            </div>

            {/* Attributes Preview */}
            <div>
              <h4 className="text-sm font-medium text-white mb-2">Attributes</h4>
              <div className="space-y-2 text-sm">
                <AttributeRow label="Generation Method" value="Smainer AI" />
                <AttributeRow label="Created At" value={new Date().toLocaleDateString()} />
                <AttributeRow label="Network" value="Starknet" />
              </div>
            </div>

            {/* Cost Info */}
            <div className="bg-[#3B82F6]/5 border border-[#3B82F6]/20 rounded-xl p-4">
              <div className="flex items-center gap-2 text-[#3B82F6] mb-3">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium">Minting Cost</span>
              </div>
              <div className="text-sm text-[var(--text-secondary)] space-y-1.5">
                <div className="flex justify-between">
                  <span>Base Fee</span>
                  <span className="text-white">~2 STRK</span>
                </div>
                <div className="flex justify-between">
                  <span>IPFS Storage</span>
                  <span className="text-white">~1 STRK</span>
                </div>
                <div className="h-px bg-[#3B82F6]/20 my-2" />
                <div className="flex justify-between font-medium">
                  <span className="text-white">Total</span>
                  <span className="text-[#3B82F6]">~3 STRK</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-[var(--surface-interactive)] border border-[var(--border-subtle)] text-white font-medium rounded-xl hover:bg-[var(--surface-elevated)] transition-colors"
              >
                Cancel
              </button>
              
              <button
                onClick={handleMint}
                disabled={!canMint}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMinting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Minting...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span>Mint NFT</span>
                  </>
                )}
              </button>
            </div>

            {/* Terms */}
            <p className="text-xs text-[var(--text-muted)] text-center leading-relaxed">
              By minting, you agree to store this NFT on Starknet. 
              All transactions are final and irreversible.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttributeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 px-3 bg-[var(--surface-interactive)] rounded-lg">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
