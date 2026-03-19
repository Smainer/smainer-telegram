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
          {
            trait_type: 'Generation Method',
            value: 'Smainer AI'
          },
          {
            trait_type: 'Created At',
            value: new Date().toISOString().split('T')[0]
          },
          {
            trait_type: 'Network',
            value: 'Starknet'
          }
        ]
      };

      await onMint(metadata);
    } catch (error) {
      console.error('Failed to mint NFT:', error);
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Mint as NFT</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Image Preview */}
          <div className="aspect-square rounded-lg overflow-hidden bg-muted">
            <img 
              src={imageUrl} 
              alt="NFT Preview" 
              className="w-full h-full object-cover"
            />
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label htmlFor="nft-name" className="block text-sm font-medium mb-2">
                NFT Name
              </label>
              <input
                id="nft-name"
                type="text"
                value={nftName}
                onChange={(e) => setNftName(e.target.value)}
                placeholder="Enter a name for your NFT"
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                maxLength={50}
              />
              <div className="text-xs text-muted-foreground mt-1">
                {nftName.length}/50 characters
              </div>
            </div>

            <div>
              <label htmlFor="nft-description" className="block text-sm font-medium mb-2">
                Description
              </label>
              <textarea
                id="nft-description"
                value={nftDescription}
                onChange={(e) => setNftDescription(e.target.value)}
                placeholder="Describe your NFT creation..."
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                rows={3}
                maxLength={200}
              />
              <div className="text-xs text-muted-foreground mt-1">
                {nftDescription.length}/200 characters
              </div>
            </div>

            {/* Attributes Preview */}
            <div>
              <h4 className="text-sm font-medium mb-2">Attributes</h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 px-2 bg-muted rounded">
                  <span className="text-muted-foreground">Generation Method:</span>
                  <span>Smainer AI</span>
                </div>
                <div className="flex justify-between py-1 px-2 bg-muted rounded">
                  <span className="text-muted-foreground">Created At:</span>
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between py-1 px-2 bg-muted rounded">
                  <span className="text-muted-foreground">Network:</span>
                  <span>Starknet</span>
                </div>
              </div>
            </div>

            {/* Cost Info */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="flex items-center space-x-2 text-purple-800 mb-2">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium">NFT Minting Cost</span>
              </div>
              <div className="text-xs text-purple-700">
                <div className="flex justify-between">
                  <span>Base Minting Fee:</span>
                  <span>0.001 ETH (~2 STRK)</span>
                </div>
                <div className="flex justify-between">
                  <span>IPFS Storage:</span>
                  <span>0.0005 ETH (~1 STRK)</span>
                </div>
                <hr className="my-1 border-purple-300" />
                <div className="flex justify-between font-medium">
                  <span>Total Cost:</span>
                  <span>~3 STRK</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-input rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Cancel
              </button>
              
              <button
                onClick={handleMint}
                disabled={!nftName.trim() || !nftDescription.trim() || isMinting}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center justify-center space-x-2"
              >
                {isMinting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Minting...</span>
                  </>
                ) : (
                  <>
                    <span>Mint NFT</span>
                  </>
                )}
              </button>
            </div>

            {/* Terms */}
            <div className="text-xs text-muted-foreground text-center">
              By minting, you agree to store this NFT on the Starknet blockchain. 
              All transactions are final and irreversible.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}