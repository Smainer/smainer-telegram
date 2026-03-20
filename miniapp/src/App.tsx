import React, { useState, useEffect } from 'react';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { DebugOverlay, addDebugBootStep } from './components/DebugOverlay';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import { useTelegramData } from './hooks/useTelegramData';
import type { ConnectedWallet, InferenceRequest } from './types';

const WALLET_STORAGE_KEY = 'smainer_connected_wallet';

function loadPersistedWallet(): ConnectedWallet | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ConnectedWallet>;
    const isValidAddress = /^0x[0-9a-fA-F]{1,64}$/.test(parsed.address || '');
    if (!isValidAddress) {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
      return null;
    }

    return {
      address: parsed.address!,
      type: parsed.type || 'manual',
      balance_strk: parsed.balance_strk || '0',
      balance_smainer: parsed.balance_smainer || '0',
    };
  } catch {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    return null;
  }
}

class WalletSectionBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Wallet section crashed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-tg-separator bg-tg-secondary-bg p-4 text-center">
          <h3 className="text-base font-semibold text-tg-text mb-2">Wallet Connect Unavailable</h3>
          <p className="text-sm text-tg-text-hint mb-4">
            Open the dedicated wallet page to connect, then return to the bot.
          </p>
          <a
            href={(import.meta.env.VITE_FRONTEND_URL || 'https://smainer.io') + '/?mode=connect'}
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-primary hover:bg-primary-hover text-white font-medium"
          >
            Open Connect Page
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(() => loadPersistedWallet());
  const [currentView, setCurrentView] = useState<'home' | 'chat' | 'nft' | 'dashboard'>('home');
  
  // Detect connect mode from URL params
  const connectMode = new URLSearchParams(window.location.search).get('mode') === 'connect';

  // Safe Telegram data access
  const { initData, miniApp, isInTelegram } = useTelegramData();
  const tgUser = initData?.user as {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    firstName?: string;
    lastName?: string;
  } | undefined;
  const displayFirstName = tgUser?.first_name || tgUser?.firstName || '';
  const displayLastName = tgUser?.last_name || tgUser?.lastName || '';
  const displayInitial = displayFirstName ? displayFirstName.charAt(0) : '👤';
  const displayUsername = tgUser?.username || (tgUser?.id ? `user${tgUser.id}` : 'user');
  // Initialize Relayer API connection
  const relayerAPI = useRelayerAPI({
    baseUrl: import.meta.env.VITE_RELAYER_URL || 'https://api.smainer.io',
    walletAddress: connectedWallet?.address,
  });

  useEffect(() => {
    // Initialize the mini app
    if (miniApp) {
      try {
        miniApp.ready();
        addDebugBootStep('telegram_miniapp_ready', 'success');
      } catch (error) {
        console.log('Mini app initialization failed:', error);
        addDebugBootStep('telegram_miniapp_ready', 'error', String(error));
      }
    } else {
      addDebugBootStep('telegram_detected', isInTelegram ? 'success' : 'error');
    }
    
    // Track connect mode
    if (connectMode) {
      addDebugBootStep('connect_mode_detected', 'success');
    }
    
    setIsLoading(false);
  }, [miniApp, isInTelegram, connectMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (connectedWallet) {
      window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(connectedWallet));
    } else {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  }, [connectedWallet]);

  const handleWalletConnect = (wallet: ConnectedWallet) => {
    setConnectedWallet(wallet);
    if (connectMode) {
      const tgWebApp = (window as any).Telegram?.WebApp;
      if (tgWebApp?.sendData) {
        const walletData = {
          action: 'wallet_connect',
          address: wallet.address,
          wallet_type: wallet.type,
        };
        try {
          tgWebApp.sendData(JSON.stringify(walletData));
        } catch (error) {
          console.error('Failed to send wallet data to Telegram bot:', error);
        }
      }
    }
    // Only auto-navigate to chat in full app mode, not in connect mode
    if (!connectMode) {
      setCurrentView('chat');
    }
  };

  const handleWalletDisconnect = () => {
    setConnectedWallet(null);
    setCurrentView('home');
  };

  const handleSubmitInferenceTask = async (request: InferenceRequest): Promise<string> => {
    try {
      const taskId = await relayerAPI.submitInferenceTask(request);
      
      // Show task submitted notification
      console.log('AI task submitted! You will receive the result shortly.');
      
      return taskId;
    } catch (error) {
      console.error('Failed to submit inference task:', error);
      alert(`Failed to submit task: ${error}`);
      
      throw error;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tg-bg">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!connectMode && isInTelegram && !connectedWallet) {
    return (
      <main className="min-h-screen p-4 bg-slate-950 text-slate-100">
        <div className="max-w-md mx-auto pt-4">
          <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900 p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-primary mb-2">Smainer Protocol</p>
            <h1 className="text-3xl font-semibold leading-tight">Private AI Inference</h1>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              Link your Starknet wallet once, then launch tasks instantly from Telegram with zero account setup.
            </p>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-6 space-y-4">
            <h2 className="text-2xl font-semibold text-white">Unlock Full App</h2>
            <p className="text-sm text-slate-300">
              Open the dedicated connect flow for best Telegram wallet compatibility, then return here.
            </p>
            <a
              href={(import.meta.env.VITE_FRONTEND_URL || 'https://smainer.io') + '/?mode=connect'}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Open Secure Wallet Connect
            </a>
            <p className="text-xs text-slate-400">Tip: after successful connect, tap Open App again to enter the full interface.</p>
          </div>
        </div>
      </main>
    );
  }

  // If no wallet connected, show connection interface
  if (!connectedWallet) {
    return (
      <main className="min-h-screen p-4 bg-tg-bg">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            {connectMode ? (
              <>
                <h1 className="text-3xl font-semibold text-primary mb-2">Connect Wallet</h1>
                <p className="text-tg-text-hint">
                  Link your Starknet wallet to continue securely.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-semibold text-primary mb-2">Smainer AI</h1>
                <p className="text-tg-text-hint">
                  Private inference on decentralized infrastructure.
                </p>
              </>
            )}
          </div>

          {/* Only show Telegram user info in full app mode */}
          {!connectMode && tgUser && (
            <div className="mb-6 p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                  <span className="text-sm">
                    {displayInitial}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-tg-text">
                    {displayFirstName} {displayLastName}
                  </p>
                  <p className="text-sm text-tg-text-hint">
                    @{displayUsername}
                  </p>
                </div>
              </div>
            </div>
          )}

          <WalletSectionBoundary>
            <WalletConnect 
              onConnect={handleWalletConnect}
              onDisconnect={handleWalletDisconnect}
            />
          </WalletSectionBoundary>

          {/* Only show connection status in full app mode */}
          {!connectMode && (
            <div className="mt-6 p-3 bg-muted/50 rounded-lg text-center">
              <div className="flex items-center justify-center space-x-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-tg-text-hint">
                  Relayer: {relayerAPI.isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {relayerAPI.availableModels.length > 0 && (
                <p className="text-xs text-tg-text-hint mt-1">
                  {relayerAPI.availableModels.length} AI models available
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    );
  }

  // If in connect mode and wallet is connected, show success message
  if (connectMode && connectedWallet) {
    return (
      <main className="min-h-screen p-4 bg-slate-950 text-slate-100">
        <div className="max-w-md mx-auto pt-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary/15 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/30">
              <svg className="w-8 h-8 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-3xl font-semibold text-primary mb-2">
              Wallet Connected
            </h1>
            <p className="text-slate-300 mb-4">
              Your wallet has been linked. You can return to chat or open the full app now.
            </p>
            <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg">
              <p className="text-sm text-slate-100 font-medium">
                {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() => {
                  try {
                    miniApp?.close();
                  } catch {
                    window.history.back();
                  }
                }}
                className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Return To Telegram Chat
              </button>

              <button
                onClick={() => {
                  // Get frontend URL from env or use fallback
                  const frontendUrl = import.meta.env.VITE_FRONTEND_URL || 'https://smainer.io';
                  window.open(frontendUrl, '_blank');
                }}
                className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg border border-slate-700 bg-slate-900 text-slate-100 font-semibold transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Open Full Smainer App
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Main app interface with navigation
  return (
    <main className="min-h-screen bg-tg-bg flex flex-col">
      {/* Navigation Bar */}
      {currentView !== 'chat' && (
        <div className="bg-tg-secondary-bg border-b border-tg-separator p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-primary">Smainer</h1>
            
            <div className="flex items-center space-x-2">
              <div className="text-xs text-tg-text-hint">
                {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
              </div>
              <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-1 mt-3">
            {[
              { id: 'home', label: 'Home', view: 'home' },
              { id: 'chat', label: 'AI Chat', view: 'chat' },
              { id: 'nft', label: 'NFTs', view: 'nft' },
              { id: 'dashboard', label: 'Dashboard', view: 'dashboard' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentView(tab.view as any)}
                className={`flex-1 px-3 py-2 text-xs rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  currentView === tab.view
                    ? 'bg-primary text-primary-foreground'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {currentView === 'home' && (
          <div className="p-4">
            <div className="max-w-md mx-auto space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-tg-text mb-2">Smainer Control Center</h2>
                <p className="text-sm text-tg-text-hint">
                  Select a workflow to run private inference, mint outputs, or review account status.
                </p>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={() => setCurrentView('chat')}
                  className="w-full p-4 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center space-x-2"
                >
                  <span>Start AI Chat</span>
                </button>
                
                <button 
                  onClick={() => setCurrentView('nft')}
                  className="w-full p-4 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center space-x-2"
                >
                  <span>Create & Mint NFTs</span>
                </button>
                
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className="w-full p-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center space-x-2"
                >
                  <span>View Dashboard</span>
                </button>
              </div>

              {/* Stats */}
              <div className="mt-8 grid grid-cols-2 gap-4">
                <div className="p-3 bg-tg-secondary-bg border border-tg-separator rounded-lg text-center">
                  <div className="text-lg font-bold text-primary">
                    {relayerAPI.availableModels.length}
                  </div>
                  <div className="text-xs text-tg-text-hint">AI Models</div>
                </div>
                <div className="p-3 bg-tg-secondary-bg border border-tg-separator rounded-lg text-center">
                  <div className="text-lg font-bold text-primary">0</div>
                  <div className="text-xs text-tg-text-hint">NFTs Minted</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'chat' && (
          <ChatInterface
            walletAddress={connectedWallet.address}
            availableModels={relayerAPI.availableModels}
            onSubmitTask={handleSubmitInferenceTask}
            onTaskUpdate={(taskId, status) => {
              console.log('Task update:', taskId, status);
              // Handle task updates
            }}
          />
        )}

        {currentView === 'nft' && (
          <div className="p-4">
            <div className="max-w-md mx-auto text-center">
              <h2 className="text-lg font-semibold text-tg-text mb-4">NFT Gallery</h2>
              <div className="p-8 border border-tg-separator rounded-lg">
                <h3 className="font-medium text-tg-text mb-2">Create AI-Generated NFTs</h3>
                <p className="text-sm text-tg-text-hint mb-4">
                  Generate images with AI and mint them as NFTs on Starknet
                </p>
                <button 
                  onClick={() => setCurrentView('chat')}
                  className="px-6 py-2 bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Start Creating
                </button>
              </div>
            </div>
          </div>
        )}

        {currentView === 'dashboard' && (
          <div className="p-4">
            <div className="max-w-md mx-auto">
              <h2 className="text-lg font-semibold text-tg-text mb-4">Dashboard</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
                  <h3 className="font-medium text-tg-text mb-2">Wallet Balance</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">STRK:</span>
                      <span className="text-sm text-tg-text">{connectedWallet.balance_strk}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">SMAINER:</span>
                      <span className="text-sm text-tg-text">{connectedWallet.balance_smainer}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
                  <h3 className="font-medium text-tg-text mb-2">Network Status</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">Relayer:</span>
                      <span className={`text-sm ${relayerAPI.isConnected ? 'text-green-600' : 'text-red-600'}`}>
                        {relayerAPI.isConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">Available Models:</span>
                      <span className="text-sm text-tg-text">{relayerAPI.availableModels.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Debug overlay for development and error diagnostics */}
      <DebugOverlay />
    </main>
  );
}