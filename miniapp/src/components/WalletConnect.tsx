'use client';

import React, { useState } from 'react';
import { useConnect, useAccount, useDisconnect } from '@starknet-react/core';

import type { ConnectedWallet } from '@/types';
import { shortenAddress } from '@/lib/starknet';

interface WalletConnectProps {
  onConnect: (wallet: ConnectedWallet) => void;
  onDisconnect: () => void;
}

export function WalletConnect({ onConnect, onDisconnect }: WalletConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const { connect, connectors } = useConnect();
  const { address, isConnected: starknetConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();

  const handleConnect = async (connectFn: () => void) => {
    try {
      setIsConnecting(true);
      connectFn();
      
      // TODO: After connection, fetch balances and create ConnectedWallet object
      setTimeout(() => {
        if (address) {
          const wallet: ConnectedWallet = {
            address,
            type: 'argentx', // Determine actual wallet type
            balance_strk: '0',
            balance_smainer: '0',
          };
          onConnect(wallet);
        }
        setIsConnecting(false);
      }, 1000);
    } catch (error) {
      console.error('Wallet connection failed:', error);
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    onDisconnect();
  };

  if (starknetConnected && address) {
    const expectedChainStr = import.meta.env.VITE_STARKNET_CHAIN_ID || 'SN_MAIN';
    const expectedChainId = expectedChainStr === 'SN_MAIN' ? BigInt('0x534e5f4d41494e') : BigInt('0x534e5f5345504f4c4941');
    const isWrongNetwork = chainId && chainId !== expectedChainId;

    if (isWrongNetwork) {
      return (
        <div className="w-full max-w-md mx-auto">
          <div className="bg-destructive/10 border border-destructive rounded-lg p-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-destructive">Wrong Network</h3>
              <p className="text-sm text-destructive/80 mt-2">Please switch to {expectedChainStr === 'SN_MAIN' ? 'Mainnet' : 'Sepolia'} to continue.</p>
            </div>
            <button onClick={handleDisconnect} className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors">
              Disconnect Wallet
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-card border rounded-lg p-6">
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-smainer-green/10 rounded-full flex items-center justify-center mx-auto mb-2">
              <svg className="w-6 h-6 text-smainer-green" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground">Wallet Connected</h3>
            <p className="text-sm text-muted-foreground">{shortenAddress(address)}</p>
          </div>
          
          <button
            onClick={handleDisconnect}
            className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
          >
            Disconnect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-foreground mb-2">Connect Your Wallet</h2>
        <p className="text-muted-foreground text-sm">
          Connect your Starknet wallet to start using Smainer AI
        </p>
      </div>

      <div className="space-y-3">
        {connectors.map((connector) => (
          <WalletOption
            key={connector.id}
            name={connector.name}
            icon={getWalletIcon(connector.id)}
            isLoading={isConnecting}
            onClick={() => handleConnect(() => connect({ connector }))}
          />
        ))}
        
        {/* Telegram Wallet option (mock for now) */}
        <WalletOption
          name="Telegram Wallet"
          icon="📱"
          isLoading={isConnecting}
          onClick={() => {
            // TODO: Implement Telegram Wallet connection
            console.log('Telegram Wallet connection coming soon');
          }}
          disabled
        />
      </div>
      
      <div className="mt-6 p-4 bg-muted/50 rounded-lg">
        <p className="text-xs text-muted-foreground text-center">
          Your wallet will be used to pay for AI inference and manage your NFTs. 
          No private keys are stored by Smainer.
        </p>
      </div>
    </div>
  );
}

interface WalletOptionProps {
  name: string;
  icon: string;
  isLoading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function WalletOption({ name, icon, isLoading, onClick, disabled = false }: WalletOptionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-center space-x-3">
        <span className="text-2xl">{icon}</span>
        <span className="font-medium">{name}</span>
        {disabled && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-normal">
            Coming Soon
          </span>
        )}
      </div>
      
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}

function getWalletIcon(walletId: string): string {
  switch (walletId.toLowerCase()) {
    case 'argentx':
      return '🔷';
    case 'braavos':
      return '🛡️';
    default:
      return '💳';
  }
}