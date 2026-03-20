import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, NavigateFunction } from 'react-router-dom';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { DebugOverlay, addDebugBootStep } from './components/DebugOverlay';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import { useTelegramData } from './hooks/useTelegramData';
import type { ConnectedWallet, InferenceRequest } from './types';

const WALLET_STORAGE_KEY = 'smainer_connected_wallet';

function getConnectPageUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/connect`;
  }
  return (import.meta.env.VITE_FRONTEND_URL || 'https://smainer-miniapp.vercel.app') + '/connect';
}

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
          <h3 className="text-base font-semibold text-tg-text mb-2">Connect Page Required</h3>
          <p className="text-sm text-tg-text-hint mb-4">
            Connect wallet on dedicated page, then return here.
          </p>
          <a
            href={getConnectPageUrl()}
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
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<MainApp />} />
      <Route path="/chat" element={<MainApp />} />
      <Route path="/nft" element={<MainApp />} />
      <Route path="/dashboard" element={<MainApp />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(() => loadPersistedWallet());
  
  // Get current view from URL
  const currentView = location.pathname.replace('/', '') as 'home' | 'chat' | 'nft' | 'dashboard';

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
  const displayInitial = displayFirstName ? displayFirstName.charAt(0) : '?';
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
    
    setIsLoading(false);
  }, [miniApp, isInTelegram]);

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

  // Cross-tab wallet sync via BroadcastChannel + storage event
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyRemoteWallet = (address: string, walletType: string) => {
      setConnectedWallet((prev) => {
        if (prev?.address === address) return prev;
        return {
          address,
          type: (walletType as ConnectedWallet['type']) || 'braavos',
          balance_strk: '0',
          balance_smainer: '0',
        };
      });
    };

    // BroadcastChannel listener (same origin, any tab)
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('smainer-wallet');
      channel.onmessage = (event) => {
        const data = event.data;
        if (data?.action === 'wallet_connect' && data.address) {
          applyRemoteWallet(data.address, data.wallet_type);
        } else if (data?.action === 'wallet_disconnect') {
          setConnectedWallet(null);
        }
      };
    } catch {
      // BroadcastChannel not supported
    }

    // localStorage 'storage' event (fires in *other* tabs on same origin)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== WALLET_STORAGE_KEY) return;
      if (!e.newValue) {
        setConnectedWallet(null);
        return;
      }
      try {
        const parsed = JSON.parse(e.newValue) as Partial<ConnectedWallet>;
        if (parsed.address && /^0x[0-9a-fA-F]{1,64}$/.test(parsed.address)) {
          applyRemoteWallet(parsed.address, parsed.type || 'braavos');
        }
      } catch { /* ignore corrupt storage */ }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — set up once, applyRemoteWallet references are stable

  const handleWalletConnect = (wallet: ConnectedWallet) => {
    setConnectedWallet(wallet);
    
    // Auto-update localStorage with latest wallet info
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));

    // Notify other tabs of new wallet connection
    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({
        action: 'wallet_connect',
        address: wallet.address,
        wallet_type: wallet.type,
      });
      channel.close();
    } catch { /* BroadcastChannel not supported */ }

    // Navigate to chat after successful connection
    navigate('/chat');
  };

  const handleWalletDisconnect = () => {
    setConnectedWallet(null);
    navigate('/home');
    // Notify other tabs of disconnect
    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({ action: 'wallet_disconnect' });
      channel.close();
    } catch { /* BroadcastChannel not supported */ }
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

  // If no wallet connected, show connection interface (all routes)
  if (!connectedWallet) {
    return (
      <main className="min-h-screen p-4 bg-tg-bg">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-semibold text-primary mb-2">Smainer Protocol</h1>
            <p className="text-tg-text-hint">
              Private compute on Starknet. Pay per task in $STRK.
            </p>
          </div>

          {/* Show Telegram user info */}
          {tgUser && (
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

          {/* Connection status */}
          <div className="mt-6 p-3 bg-muted/50 rounded-lg text-center">
            <div className="flex items-center justify-center space-x-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-tg-text-hint">
                Relayer: {relayerAPI.isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {relayerAPI.availableModels.length > 0 && (
              <p className="text-xs text-tg-text-hint mt-1">
                {relayerAPI.availableModels.length} compute nodes online
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Main app interface with navigation and routing
  return (
    <main className="min-h-screen bg-tg-bg flex flex-col">
      <AppLayout 
        connectedWallet={connectedWallet}
        relayerAPI={relayerAPI}
        currentView={currentView}
        navigate={navigate}
      />
      
      {/* Route Content */}
      <div className="flex-1 overflow-hidden">
        {currentView === 'home' && (
          <HomeView 
            navigate={navigate}
            relayerAPI={relayerAPI}
          />
        )}
        
        {currentView === 'chat' && (
          <ChatInterface
            walletAddress={connectedWallet.address}
            availableModels={relayerAPI.availableModels}
            onSubmitTask={handleSubmitInferenceTask}
            onTaskUpdate={(taskId, status) => {
              console.log('Task update:', taskId, status);
            }}
          />
        )}
        
        {currentView === 'nft' && (
          <NFTView navigate={navigate} />
        )}
        
        {currentView === 'dashboard' && (
          <DashboardView 
            connectedWallet={connectedWallet}
            relayerAPI={relayerAPI}
          />
        )}
      </div>
      
      {/* Navigation Bar - Fixed at bottom for mobile */}
      <BottomNavigation currentView={currentView} navigate={navigate} />
      
      {/* Debug overlay for development and error diagnostics */}
      <DebugOverlay />
    </main>
  );
}

// Layout component with header and back button
function AppLayout({ 
  connectedWallet, 
  relayerAPI, 
  currentView,
  navigate 
}: { 
  connectedWallet: ConnectedWallet
  relayerAPI: any
  currentView: string
  navigate: NavigateFunction
}) {
  return (
    <div className="bg-tg-secondary-bg border-b border-tg-separator p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {currentView !== 'home' && (
            <button
              onClick={() => navigate('/home')}
              className="p-1 text-tg-text-hint hover:text-tg-text"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h1 className="text-xl font-bold text-primary">Smainer</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="text-xs text-tg-text-hint">
            {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
          </div>
          <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>
      </div>
    </div>
  );
}

// Home view component
function HomeView({ navigate, relayerAPI }: { navigate: NavigateFunction, relayerAPI: any }) {
  return (
    <div className="p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="text-center mb-6">
          <h2 className="text-lg font-semibold text-tg-text mb-2">Smainer Control Center</h2>
          <p className="text-sm text-tg-text-hint">
            Select a workflow to run private compute, mint results, or check status.
          </p>
        </div>

        <div className="space-y-3">
          <button 
            onClick={() => navigate('/chat')}
            className="w-full p-4 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex items-center justify-center space-x-2"
          >
            <span>Run Compute Task</span>
          </button>
          
          <button 
            onClick={() => navigate('/nft')}
            className="w-full p-4 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center space-x-2"
          >
            <span>Create & Mint NFTs</span>
          </button>
          
          <button 
            onClick={() => navigate('/dashboard')}
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
            <div className="text-xs text-tg-text-hint">Compute Nodes</div>
          </div>
          <div className="p-3 bg-tg-secondary-bg border border-tg-separator rounded-lg text-center">
            <div className="text-lg font-bold text-primary">0</div>
            <div className="text-xs text-tg-text-hint">NFTs Minted</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// NFT view component  
function NFTView({ navigate }: { navigate: NavigateFunction }) {
  return (
    <div className="p-4">
      <div className="max-w-md mx-auto text-center">
        <h2 className="text-lg font-semibold text-tg-text mb-4">NFT Gallery</h2>
        <div className="p-8 border border-tg-separator rounded-lg">
            <h3 className="font-medium text-tg-text mb-2">Mint Compute Results</h3>
          <p className="text-sm text-tg-text-hint mb-4">
            Turn generated outputs into verified NFTs on Starknet
          </p>
          <button 
            onClick={() => navigate('/chat')}
            className="px-6 py-2 bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Start Creating
          </button>
        </div>
      </div>
    </div>
  );
}

// Dashboard view component
function DashboardView({ connectedWallet, relayerAPI }: { connectedWallet: ConnectedWallet, relayerAPI: any }) {
  return (
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
  );
}

// Bottom navigation component
function BottomNavigation({ currentView, navigate }: { currentView: string, navigate: NavigateFunction }) {
  const tabs = [
    { id: 'home', label: 'Home', path: '/home', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    )},
    { id: 'chat', label: 'Compute', path: '/chat', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
    )},
    { id: 'nft', label: 'NFTs', path: '/nft', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
    )},
    { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
    )},
  ];

  return (
    <div className="bg-tg-secondary-bg border-t border-tg-separator p-2 safe-area-bottom">
      <div className="flex space-x-1 max-w-md mx-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={`flex-1 flex flex-col items-center px-2 py-2 text-xs rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              currentView === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-tg-text-hint hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="mb-1">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}