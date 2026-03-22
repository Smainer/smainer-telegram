import React, { useEffect, useRef, useState } from 'react';
import { useConnect, useAccount, useDisconnect } from '@starknet-react/core';

import type { ConnectedWallet } from '@/types';
import { shortenAddress } from '@/lib/starknet';

interface WalletConnectProps {
  onConnect: (wallet: ConnectedWallet) => void;
  onDisconnect: () => void;
}

export function WalletConnect({ onConnect, onDisconnect }: WalletConnectProps) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const { connect, connectors } = useConnect();
  const { address, isConnected: starknetConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const lastSyncedAddress = useRef<string | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        {connectors.length === 0 ? (
          <>
            <p className="wallet-warning">No wallet detected. Install one below:</p>
            <WalletLink name="Argent X" href="https://chrome.google.com/webstore/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb" />
            <WalletLink name="Braavos" href="https://chrome.google.com/webstore/detail/braavos-smart-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma" />
          </>
        ) : (
          <>
            {connectors.map((connector) => (
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
              onClick={() => {}}
              disabled
            />
          </>
        )}
      </div>

      <div className="wallet-footer">
        <p>Pay for compute in $STRK. No private keys stored.</p>
      </div>
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
