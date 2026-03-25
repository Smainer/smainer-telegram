import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useConnect, useAccount, useDisconnect } from '@starknet-react/core';

import type { ConnectedWallet } from '@/types';
import { shortenAddress } from '@/lib/starknet';

// Detect if running inside Telegram WebApp
function isTelegramWebApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp;
}

interface WalletConnectProps {
  onConnect: (wallet: ConnectedWallet) => void;
  onDisconnect: () => void;
}

export function WalletConnect({ onConnect, onDisconnect }: WalletConnectProps) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [showTelegramWalletInfo, setShowTelegramWalletInfo] = useState(false);
  const { connect, connectors } = useConnect();
  const { address, isConnected: starknetConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const lastSyncedAddress = useRef<string | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const isTelegram = useMemo(() => isTelegramWebApp(), []);
  
  // Filter to only available connectors
  const availableConnectors = useMemo(() => {
    return connectors.filter(c => {
      try {
        return c.available();
      } catch {
        return false;
      }
    });
  }, [connectors]);

  useEffect(() => {
    if (!starknetConnected && !connectingId) {
      const lastConnectorId = localStorage.getItem('starknet-react.lastUsedConnector');
      if (lastConnectorId) {
        const connector = connectors.find(c => c.id === lastConnectorId);
        if (connector && connector.available()) {
          connect({ connector });
        }
      }
    }
  }, [connect, connectors, connectingId, starknetConnected]);

  useEffect(() => {
    if (starknetConnected && address && lastSyncedAddress.current !== address) {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      const wallet: ConnectedWallet = {
        address,
        type: 'argentx',
        balance_strk: '0',
        balance_smainer: '0',
      };
      lastSyncedAddress.current = address;
      onConnect(wallet);
      setConnectingId(null);
      return;
    }
    if (!starknetConnected) {
      lastSyncedAddress.current = null;
    }
  }, [address, onConnect, starknetConnected]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, []);

  const handleConnect = async (connector: any) => {
    if (connectingId) return; // Prevent multiple clicks
    try {
      setConnectingId(connector.id);
      // Timeout after 8 seconds
      connectionTimeoutRef.current = setTimeout(() => {
        setConnectingId(null);
        console.warn('Wallet connection timed out');
      }, 8000);
      await connect({ connector });
    } catch (error) {
      console.error('Wallet connection failed:', error);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      setConnectingId(null);
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
        <div className="wallet-container">
          <div className="wallet-card wallet-card--error">
            <p className="wallet-error-text">Wrong Network</p>
            <p className="wallet-subtext">Switch to {expectedChainStr === 'SN_MAIN' ? 'Mainnet' : 'Sepolia'}</p>
            <button onClick={handleDisconnect} className="wallet-btn wallet-btn--error">
              Disconnect
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="wallet-container">
        <div className="wallet-card">
          <p className="wallet-subtext">Connected</p>
          <p className="wallet-address">{shortenAddress(address)}</p>
          <button onClick={handleDisconnect} className="wallet-btn wallet-btn--secondary">
            Disconnect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-container">
      <div className="wallet-header">
        <h2 className="wallet-title">Connect Wallet</h2>
        <p className="wallet-subtext">Link your Starknet wallet to submit compute tasks</p>
      </div>

      <div className="wallet-list">
        {isTelegram && availableConnectors.length === 0 ? (
          <>
            <div className="wallet-telegram-notice">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>
                Tap a wallet below to connect via the mobile app.
              </p>
            </div>
            <TelegramWalletDeepLinks />
          </>
        ) : availableConnectors.length === 0 ? (
          <>
            <p className="wallet-warning">No wallet detected. Install one below:</p>
            <WalletLink name="Argent X" href="https://chrome.google.com/webstore/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb" />
            <WalletLink name="Braavos" href="https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma" />
          </>
        ) : (
          <>
            {availableConnectors.map((connector) => (
              <WalletButton
                key={connector.id}
                name={connector.name}
                walletId={connector.id}
                isLoading={connectingId === connector.id}
                onClick={() => handleConnect(connector)}
              />
            ))}
            <WalletButton
              name="Telegram Wallet"
              walletId="telegram"
              isLoading={false}
              onClick={() => setShowTelegramWalletInfo(true)}
              disabled
            />
          </>
        )}
      </div>

      <div className="wallet-footer">
        <p>Pay for compute in $STRK. No private keys stored.</p>
      </div>

      {/* Telegram Wallet Info Modal */}
      {showTelegramWalletInfo && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setShowTelegramWalletInfo(false)}
        >
          <div 
            style={{
              background: '#1A1A2E',
              border: '1px solid #2A2A4A',
              borderRadius: 16,
              padding: 24,
              maxWidth: 340,
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ 
                width: 40, 
                height: 40, 
                borderRadius: 10, 
                background: '#2A2A4A', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M21 3L10 14M21 3l-7 18-4-8-8-4 18-7z" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#FFFFFF', margin: 0 }}>
                Telegram Wallet
              </h3>
            </div>
            
            <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.6, margin: 0, marginBottom: 20 }}>
              Telegram Wallet uses the TON blockchain. Smainer runs on Starknet. We're exploring cross-chain bridges to support TON payments in the future.
            </p>
            
            <button
              onClick={() => setShowTelegramWalletInfo(false)}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: '#3B82F6',
                border: 'none',
                borderRadius: 10,
                color: 'white',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface WalletButtonProps {
  name: string;
  walletId: string;
  isLoading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function WalletButton({ name, walletId, isLoading, onClick, disabled = false }: WalletButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={disabled || isLoading}
      className={`wallet-option ${isHovered ? 'wallet-option--hover' : ''} ${disabled ? 'wallet-option--disabled' : ''}`}
    >
      <div className="wallet-option__icon">
        {isLoading ? <div className="wallet-spinner" /> : <WalletIcon walletId={walletId} />}
      </div>
      <div className="wallet-option__info">
        <span className="wallet-option__name">{name}</span>
      </div>
      {disabled && <span className="wallet-option__badge">Coming Soon</span>}
    </button>
  );
}

function WalletLink({ name, href }: { name: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="wallet-option">
      <div className="wallet-option__icon">
        <WalletIcon walletId={name === 'Argent X' ? 'argentx' : 'braavos'} />
      </div>
      <div className="wallet-option__info">
        <span className="wallet-option__name">Install {name}</span>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="wallet-option__external">
        <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function TelegramWalletDeepLinks() {
  const tg = (window as any).Telegram?.WebApp;

  const handleBraavosDeepLink = () => {
    // Braavos dApp deep link format
    // Format: https://link.braavos.app/dapp/<host>/<path>
    const braavosUrl = `https://link.braavos.app/dapp/${window.location.host}/connect?return=telegram`;
    
    if (tg?.openLink) {
      tg.openLink(braavosUrl, { try_instant_view: false });
    } else {
      window.open(braavosUrl, '_blank');
    }
  };

  const handleArgentBrowserConnect = () => {
    // Argent X doesn't have mobile deep links like Braavos.
    // Open the connect page in the user's external browser where
    // the Argent X extension is available.
    const browserConnectUrl = `${window.location.origin}/connect?return=telegram`;
    
    if (tg?.openLink) {
      tg.openLink(browserConnectUrl, { try_instant_view: false });
    } else {
      window.open(browserConnectUrl, '_blank');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={handleBraavosDeepLink}
        style={{
          width: '100%',
          padding: '14px 20px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 12,
          color: 'white',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <WalletIcon walletId="braavos" />
        Connect with Braavos
      </button>
      <button
        onClick={handleArgentBrowserConnect}
        style={{
          width: '100%',
          padding: '14px 20px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 12,
          color: 'white',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <WalletIcon walletId="argentx" />
        Connect with Argent X (Browser)
      </button>
      <p style={{ 
        color: 'var(--text-muted)', 
        fontSize: 12, 
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 1.5,
      }}>
        Braavos opens your wallet app. Argent X opens a browser where the extension can connect.
      </p>
    </div>
  );
}

function WalletIcon({ walletId }: { walletId: string }) {
  switch (walletId.toLowerCase()) {
    case 'argentx':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 3L4 7v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V7l-8-4z" stroke="white" strokeWidth="1.5" />
          <path d="M12 8v8M9 13h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'braavos':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 4c-2 0-4 2-4 5 0 4 2 7 4 8 2-1 4-4 4-8 0-3-2-5-4-5z" stroke="white" strokeWidth="1.5" />
          <path d="M8 9c-1 1-2 3-2 5s1 4 3 6M16 9c1 1 2 3 2 5s-1 4-3 6" stroke="white" strokeWidth="1.5" />
        </svg>
      );
    case 'telegram':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M21 3L10 14M21 3l-7 18-4-8-8-4 18-7z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="white" strokeWidth="1.5" />
          <path d="M3 10h18" stroke="white" strokeWidth="1.5" />
        </svg>
      );
  }
}
