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
  const [hoveredWallet, setHoveredWallet] = useState<string | null>(null);
  const { connect, connectors } = useConnect();
  const { address, isConnected: starknetConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const lastSyncedAddress = useRef<string | null>(null);

  // Auto-connect logic
  useEffect(() => {
    if (!starknetConnected && !isConnecting) {
      const lastConnectorId = localStorage.getItem('starknet-react.lastUsedConnector');
      if (lastConnectorId) {
        const connector = connectors.find(c => c.id === lastConnectorId);
        if (connector && connector.available()) {
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

  // Connected state - wrong network
  if (starknetConnected && address) {
    const expectedChainStr = import.meta.env.VITE_STARKNET_CHAIN_ID || 'SN_MAIN';
    const expectedChainId = expectedChainStr === 'SN_MAIN' ? BigInt('0x534e5f4d41494e') : BigInt('0x534e5f5345504f4c4941');
    const isWrongNetwork = chainId && chainId !== expectedChainId;

    if (isWrongNetwork) {
      return (
        <div className="w-full max-w-md mx-auto px-4">
          <div className="bg-[var(--surface-card)] border border-[var(--error)] rounded-2xl p-6">
            <div className="text-center mb-5">
              <div className="w-14 h-14 bg-[var(--error-muted)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--error)] mb-2">Wrong Network</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Switch to {expectedChainStr === 'SN_MAIN' ? 'Starknet Mainnet' : 'Sepolia Testnet'}
              </p>
            </div>
            <button 
              onClick={handleDisconnect} 
              className="w-full h-12 bg-[var(--error)] text-white font-semibold rounded-xl 
                         hover:bg-[var(--error)]/90 active:scale-[0.98] transition-all duration-150"
            >
              Disconnect
            </button>
          </div>
        </div>
      );
    }

    // Connected successfully
    return (
      <div className="w-full max-w-md mx-auto px-4">
        <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-2xl p-6">
          <div className="text-center mb-5">
            <div className="w-14 h-14 bg-[var(--surface-accent)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-[var(--blue)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">Wallet Connected</h3>
            <p className="text-sm text-[var(--text-muted)] font-mono">{shortenAddress(address)}</p>
          </div>
          <button
            onClick={handleDisconnect}
            className="w-full h-12 bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium rounded-xl 
                       border border-[var(--border-subtle)] hover:bg-[var(--surface-interactive)] 
                       hover:border-[var(--border-default)] active:scale-[0.98] transition-all duration-150"
          >
            Disconnect Wallet
          </button>
        </div>
      </div>
    );
  }

  // Not connected - show wallet options
  return (
    <div className="w-full max-w-md mx-auto px-4 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white mb-2">Connect Wallet</h2>
        <p className="text-[var(--text-muted)] text-sm leading-relaxed">
          Link your Starknet wallet to submit compute tasks
        </p>
      </div>

      {/* Wallet Options */}
      {connectors.length === 0 ? (
        <NoWalletsState />
      ) : (
        <div className="space-y-3">
          {connectors.map((connector) => (
            <WalletButton
              key={connector.id}
              name={connector.name}
              walletId={connector.id}
              isLoading={isConnecting}
              isHovered={hoveredWallet === connector.id}
              onHover={() => setHoveredWallet(connector.id)}
              onLeave={() => setHoveredWallet(null)}
              onClick={() => handleConnect(connector)}
            />
          ))}
          
          {/* Telegram Wallet - Coming Soon */}
          <WalletButton
            name="Telegram Wallet"
            walletId="telegram"
            isLoading={false}
            isHovered={hoveredWallet === 'telegram'}
            onHover={() => setHoveredWallet('telegram')}
            onLeave={() => setHoveredWallet(null)}
            onClick={() => {}}
            disabled
          />
        </div>
      )}
      
      {/* Footer notice */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-xl p-4">
        <p className="text-xs text-[var(--text-muted)] text-center leading-relaxed">
          Your wallet pays for compute tasks in $STRK.
          <br />
          <span className="text-[var(--text-hint)]">No private keys stored by Smainer.</span>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Button Component
// ─────────────────────────────────────────────────────────────────────────────

interface WalletButtonProps {
  name: string;
  walletId: string;
  isLoading: boolean;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  disabled?: boolean;
}

function WalletButton({ 
  name, 
  walletId, 
  isLoading, 
  isHovered,
  onHover,
  onLeave,
  onClick, 
  disabled = false 
}: WalletButtonProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onTouchStart={onHover}
      onTouchEnd={onLeave}
      disabled={disabled || isLoading}
      className={`
        w-full flex items-center gap-4 p-4 rounded-xl
        bg-[var(--surface-card)] border border-[var(--border-subtle)]
        hover:bg-[var(--surface-card-hover)] hover:border-[var(--border-default)]
        active:scale-[0.98] transition-all duration-200 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
        group
      `}
    >
      {/* Icon - Monochrome, consistent 40x40 */}
      <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[var(--surface-elevated)] 
                      flex items-center justify-center group-hover:bg-[var(--surface-glass)]
                      transition-colors duration-200">
        <WalletIcon walletId={walletId} />
      </div>
      
      {/* Name + Badge */}
      <div className="flex-1 min-w-0 text-left">
        <span className="block font-medium text-white text-[15px] truncate">{name}</span>
        
        {/* Coming Soon - Only visible on hover for disabled items */}
        {disabled && (
          <span className={`
            text-xs text-[var(--text-hint)] mt-0.5
            transition-all duration-200 ease-out
            ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'}
          `}>
            Coming Soon
          </span>
        )}
      </div>
      
      {/* Arrow / Loading */}
      <div className="flex-shrink-0">
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-[var(--blue)] border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg 
            className="w-5 h-5 text-[var(--text-hint)] group-hover:text-[var(--text-muted)] 
                       group-hover:translate-x-0.5 transition-all duration-200" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monochrome Wallet Icons (24x24, stroke-based)
// ─────────────────────────────────────────────────────────────────────────────

function WalletIcon({ walletId }: { walletId: string }) {
  const iconClass = "w-6 h-6 text-white";
  
  switch (walletId.toLowerCase()) {
    case 'argentx':
      // Argent X - Stylized "A" shield
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path 
            d="M12 3L4 7v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V7l-8-4z" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
          <path 
            d="M12 8v8M9 13h6" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round"
          />
        </svg>
      );
      
    case 'braavos':
      // Braavos - Stylized shield/eagle
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path 
            d="M12 4c-2 0-4 2-4 5 0 4 2 7 4 8 2-1 4-4 4-8 0-3-2-5-4-5z" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
          <path 
            d="M8 9c-1 1-2 3-2 5s1 4 3 6M16 9c1 1 2 3 2 5s-1 4-3 6" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round"
          />
        </svg>
      );
      
    case 'telegram':
      // Telegram - Paper plane
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path 
            d="M21 3L10 14M21 3l-7 18-4-8-8-4 18-7z" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
        </svg>
      );
      
    default:
      // Generic wallet
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path 
            d="M19 7H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2z" 
            stroke="currentColor" 
            strokeWidth="1.5"
          />
          <path 
            d="M16 13h.01M3 7V6a2 2 0 012-2h12a2 2 0 012 2v1" 
            stroke="currentColor" 
            strokeWidth="1.5" 
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// No Wallets Detected State
// ─────────────────────────────────────────────────────────────────────────────

function NoWalletsState() {
  return (
    <div className="space-y-4">
      {/* Warning Card */}
      <div className="bg-[var(--surface-card)] border border-[var(--warning)]/30 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[var(--warning-muted)] 
                          flex items-center justify-center">
            <svg className="w-5 h-5 text-[var(--warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-1">No Wallet Found</h3>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Install a Starknet wallet extension to continue.
            </p>
          </div>
        </div>
      </div>
      
      {/* Install Links */}
      <div className="space-y-3">
        <InstallWalletLink 
          name="Argent X" 
          walletId="argentx"
          href="https://chrome.google.com/webstore/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb" 
        />
        <InstallWalletLink 
          name="Braavos" 
          walletId="braavos"
          href="https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma" 
        />
      </div>
    </div>
  );
}

function InstallWalletLink({ name, walletId, href }: { name: string; walletId: string; href: string }) {
  return (
    <a 
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full flex items-center gap-4 p-4 rounded-xl
                 bg-[var(--surface-card)] border border-[var(--border-subtle)]
                 hover:bg-[var(--surface-card-hover)] hover:border-[var(--border-default)]
                 active:scale-[0.98] transition-all duration-200 group"
    >
      <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[var(--surface-elevated)] 
                      flex items-center justify-center group-hover:bg-[var(--surface-glass)]
                      transition-colors duration-200">
        <WalletIcon walletId={walletId} />
      </div>
      <span className="flex-1 font-medium text-white text-[15px]">Install {name}</span>
      <svg 
        className="w-5 h-5 text-[var(--text-hint)] group-hover:text-[var(--text-muted)] transition-colors" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
