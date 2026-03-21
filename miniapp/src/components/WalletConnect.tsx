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
              className="w-full flex items-center gap-3 p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] transition-colors"
            >
              <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[#FF875B]/15 flex items-center justify-center">
                <ArgentLogo />
              </div>
              <span className="flex-1 font-semibold text-sm text-white">Install Argent X</span>
              <svg className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            
            <a 
              href="https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] transition-colors"
            >
              <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[#F5C14F]/15 flex items-center justify-center">
                <BraavosLogo />
              </div>
              <span className="flex-1 font-semibold text-sm text-white">Install Braavos</span>
              <svg className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              walletId={connector.id}
              isLoading={isConnecting}
              onClick={() => handleConnect(connector)}
            />
          ))}
          
          {/* Telegram Wallet option (mock for now) */}
          <WalletOption
            name="Telegram Wallet"
            walletId="telegram"
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
  walletId: string;
  isLoading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

// Argent X Logo SVG
function ArgentLogo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
      <path d="M18.316 4.938a2.5 2.5 0 0 0-4.632 0l-8.5 21a2.5 2.5 0 0 0 4.632 1.874L12.5 21h7l2.684 6.812a2.5 2.5 0 0 0 4.632-1.874l-8.5-21zM16 8.5l4 9h-8l4-9z" fill="#FF875B"/>
    </svg>
  );
}

// Braavos Logo SVG  
function BraavosLogo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
      <path d="M16 4c-2.5 0-4.5 1-6 3-1.5 2-2.5 5-2.5 8 0 4 1.5 7 4 9 2 1.5 4 2.5 4.5 4v-4c-2-1-4-3-4-6 0-2 1-4 2-5s2-1.5 2-1.5 1 .5 2 1.5 2 3 2 5c0 3-2 5-4 6v4c.5-1.5 2.5-2.5 4.5-4 2.5-2 4-5 4-9 0-3-1-6-2.5-8s-3.5-3-6-3z" fill="#F5C14F"/>
    </svg>
  );
}

// Telegram Logo SVG
function TelegramLogo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
      <path d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm5.562 8.161l-1.97 9.287c-.146.658-.537.818-1.084.508l-3-2.211-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.332-.373-.119l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.582-4.461c.538-.194 1.006.128.821.934z" fill="#29B6F6"/>
    </svg>
  );
}

function WalletOption({ name, walletId, isLoading, onClick, disabled = false }: WalletOptionProps) {
  const getWalletIcon = () => {
    switch (walletId.toLowerCase()) {
      case 'argentx':
        return <ArgentLogo />;
      case 'braavos':
        return <BraavosLogo />;
      case 'telegram':
        return <TelegramLogo />;
      default:
        return <span className="text-white font-bold text-sm">W</span>;
    }
  };

  const getWalletBg = () => {
    switch (walletId.toLowerCase()) {
      case 'argentx':
        return 'bg-[#FF875B]/15';
      case 'braavos':
        return 'bg-[#F5C14F]/15';
      case 'telegram':
        return 'bg-[#29B6F6]/15';
      default:
        return 'bg-[var(--surface-glass)]';
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full flex items-center gap-3 p-4 border border-[var(--border-subtle)] rounded-xl hover:bg-[var(--surface-interactive)] hover:border-[var(--border-interactive)] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* Wallet Icon */}
      <div className={`w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center ${getWalletBg()}`}>
        {getWalletIcon()}
      </div>
      
      {/* Name + Badge */}
      <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
        <span className="font-semibold text-sm truncate max-w-full">{name}</span>
        {disabled && (
          <span className="text-[10px] bg-[var(--surface-glass)] text-[var(--text-muted)] px-2 py-0.5 rounded">
            Coming Soon
          </span>
        )}
      </div>
      
      {/* Arrow / Loading */}
      <div className="flex-shrink-0">
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </button>
  );
}

function getWalletId(connectorId: string): string {
  return connectorId.toLowerCase();
}