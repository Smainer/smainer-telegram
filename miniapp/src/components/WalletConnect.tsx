'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  const { address, isConnected: starknetConnected, chainId, status: accountStatus } = useAccount();
  const { disconnect } = useDisconnect();
  const lastSyncedAddress = useRef<string | null>(null);

  // Auto-connect logic: check if we have a last used connector in localStorage
  useEffect(() => {
    if (!starknetConnected && !isConnecting) {
      const lastConnectorId = localStorage.getItem('starknet-react.lastUsedConnector');
      if (lastConnectorId) {
        const connector = connectors.find(c => c.id === lastConnectorId);
        if (connector && connector.available()) {
          console.log('Attempting auto-connect to:', lastConnectorId);
          connect({ connector });
        }
      }
    }
  }, [connect, connectors, isConnecting, starknetConnected]);

  useEffect(() => {
    if (starknetConnected && address && lastSyncedAddress.current !== address) {
      const wallet: ConnectedWallet = {
        address,
        type: 'argentx',
        balance_strk: '0',
        balance_smainer: '0',
      };
      lastSyncedAddress.current = address;
      onConnect(wallet);
      setIsConnecting(false);
      return;
    }

    if (!starknetConnected) {
      lastSyncedAddress.current = null;
      setIsConnecting(false);
    }
  }, [address, onConnect, starknetConnected]);

  const handleConnect = async (connector: any) => {
    try {
      setIsConnecting(true);
      await connect({ connector });
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
          <div className="card p-6 border border-[var(--error)]">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-[var(--error)]">Wrong Network</h3>
              <p className="text-sm text-[var(--error)]/80 mt-2">Please switch to {expectedChainStr === 'SN_MAIN' ? 'Mainnet' : 'Sepolia'} to continue.</p>
            </div>
            <button onClick={handleDisconnect} className="w-full px-4 py-2 bg-[var(--error)] text-white font-semibold rounded-xl hover:bg-[var(--error)]/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--error)]">
              Disconnect Wallet
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-md mx-auto">
        <div className="card p-6">
          <div className="text-center mb-4">
            <div className="w-12 h-12 bg-[#3B82F6]/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#3B82F6]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white">Wallet Connected</h3>
            <p className="text-sm text-[var(--text-muted)]">{shortenAddress(address)}</p>
          </div>
          
          <button
            onClick={handleDisconnect}
            className="w-full px-4 py-2 bg-[var(--error)] text-white font-semibold rounded-xl hover:bg-[var(--error)]/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--error)]"
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
        <h2 className="text-xl font-semibold text-white mb-2">Connect Wallet</h2>
        <p className="text-[var(--text-muted)] text-sm">
          Connect Starknet wallet to submit compute tasks
        </p>
      </div>

      {/* Show message if no connectors are available */}
      {connectors.length === 0 ? (
        <div className="space-y-4">
          <div className="p-6 border border-[var(--error)] rounded-xl bg-[var(--error)]/5">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-[var(--error)] mb-2">
                No Wallet Detected
              </h3>
              <p className="text-sm text-[var(--error)]/80 mb-4">
                No Starknet wallet found in this browser.
              </p>
              <div className="text-sm text-[var(--text-muted)] space-y-2">
                <p className="font-medium">To submit compute tasks:</p>
                <ul className="list-disc list-inside space-y-1 text-left">
                  <li>Install Argent X or Braavos wallet extension</li>
                  <li>Open this app in a browser (Chrome, Firefox, etc.)</li>
                  <li>Make sure the wallet extension is enabled</li>
                </ul>
              </div>
            </div>
          </div>
          
          {/* Direct links to wallet installations */}
          <div className="space-y-3">
            <a 
              href="https://chrome.google.com/webstore/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">A</span>
                </div>
                <span className="font-medium text-white">Install Argent X</span>
              </div>
              <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            
            <a 
              href="https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#3B82F6] flex items-center justify-center">
                  <span className="text-white font-bold text-sm">B</span>
                </div>
                <span className="font-medium text-white">Install Braavos</span>
              </div>
              <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {connectors.map((connector) => (
            <WalletOption
              key={connector.id}
              name={connector.name}
              letter={getWalletLetter(connector.id)}
              isLoading={isConnecting}
              onClick={() => handleConnect(connector)}
            />
          ))}
          
          {/* Telegram Wallet option (mock for now) */}
          <WalletOption
            name="Telegram Wallet"
            letter="T"
            isLoading={isConnecting}
            onClick={() => {
              // TODO: Implement Telegram Wallet connection
              console.log('Telegram Wallet connection coming soon');
            }}
            disabled
          />
        </div>
      )}
      
      <div className="mt-6 p-4 bg-[var(--surface-interactive)] border border-[var(--border-subtle)] rounded-xl">
        <p className="text-xs text-[var(--text-muted)] text-center">
          Your wallet will be used to pay for compute tasks in $STRK. 
          No private keys are stored by Smainer.
        </p>
      </div>
    </div>
  );
}

interface WalletOptionProps {
  name: string;
  letter: string;
  isLoading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function WalletOption({ name, letter, isLoading, onClick, disabled = false }: WalletOptionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full flex items-center justify-between p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] hover:border-[var(--border-interactive)] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-center space-x-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          letter === 'A' 
            ? 'bg-blue-600' 
            : letter === 'B' 
            ? 'bg-[#3B82F6]' 
            : 'bg-[var(--surface-accent)]'
        }`}>
          <span className="text-white font-bold text-sm">{letter}</span>
        </div>
        <span className="font-medium">{name}</span>
        {disabled && (
          <span className="text-xs bg-[#3B82F6]/10 text-[#3B82F6] px-2 py-1 rounded font-normal">
            Coming Soon
          </span>
        )}
      </div>
      
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}

function getWalletLetter(walletId: string): string {
  switch (walletId.toLowerCase()) {
    case 'argentx':
      return 'A';
    case 'braavos':
      return 'B';
    default:
      return 'W';
  }
}