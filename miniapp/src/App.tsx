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
        <div className="card-elevated p-6 text-center">
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">Connect Page Required</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Connect wallet on dedicated page, then return here.
          </p>
          <a
            href={getConnectPageUrl()}
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-[var(--champagne)] hover:bg-[var(--champagne-hover)] text-black font-semibold transition-all duration-200 glow-champagne"
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

  // ─── Loading State ───
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--surface-void)' }}>
        <div className="flex items-center space-x-1 mb-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--champagne)] to-[var(--cyan)] opacity-80" />
        </div>
        <div className="flex space-x-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--champagne)] loading-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--champagne)] loading-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--champagne)] loading-dot" />
        </div>
      </div>
    );
  }

  // ─── Not Connected — Onboarding ───
  if (!connectedWallet) {
    return (
      <main className="min-h-screen p-4" style={{ background: 'var(--surface-void)' }}>
        <div className="max-w-md mx-auto pt-8">
          {/* Hero */}
          <div className="text-center mb-8 animate-fade-in">
            <div className="flex items-center justify-center mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--champagne)] to-[var(--cyan)] opacity-90" />
            </div>
            <h1 className="text-2xl font-mono font-semibold text-[var(--text-primary)] tracking-tight mb-2">
              SMAINER
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Private compute on Starknet. Pay per task in $STRK.
            </p>
          </div>

          {/* User info card */}
          {tgUser && (
            <div className="card-elevated p-4 mb-6 animate-fade-in stagger-1">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                     style={{ background: 'var(--surface-interactive)', border: '1px solid var(--border-subtle)' }}>
                  <span className="text-sm font-mono font-semibold text-[var(--champagne)]">
                    {displayInitial}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-[var(--text-primary)] text-sm">
                    {displayFirstName} {displayLastName}
                  </p>
                  <p className="text-xs font-mono text-[var(--text-muted)]">
                    @{displayUsername}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="animate-fade-in stagger-2">
            <WalletSectionBoundary>
              <WalletConnect 
                onConnect={handleWalletConnect}
                onDisconnect={handleWalletDisconnect}
              />
            </WalletSectionBoundary>
          </div>

          {/* Connection status */}
          <div className="mt-6 card-elevated p-3 animate-fade-in stagger-3">
            <div className="flex items-center justify-center space-x-2 text-xs">
              <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)] glow-success' : 'bg-[var(--error)] glow-error'} animate-breathe`} />
              <span className="text-[var(--text-muted)] font-mono">
                Relayer {relayerAPI.isConnected ? 'Online' : 'Offline'}
              </span>
            </div>
            {relayerAPI.availableModels.length > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] text-center mt-1 font-mono">
                {relayerAPI.availableModels.length} node{relayerAPI.availableModels.length !== 1 ? 's' : ''} active
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ─── Main App (Connected) ───
  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--surface-void)' }}>
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
      
      {/* Floating Navigation */}
      <BottomNavigation currentView={currentView} navigate={navigate} />
      
      <DebugOverlay />
    </main>
  );
}

// ─── Header ───
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
    <div className="px-4 py-3" style={{ background: 'var(--surface-void)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {currentView !== 'home' && (
            <button
              onClick={() => navigate('/home')}
              className="p-1.5 rounded-lg transition-colors duration-200 hover:bg-[var(--surface-interactive)] group"
            >
              <svg className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--champagne)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--champagne)] to-[var(--cyan)] opacity-90" />
            <h1 className="text-base font-mono font-semibold text-[var(--text-primary)] tracking-tight">
              SMAINER
            </h1>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="px-2.5 py-1 rounded-lg" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)' }}>
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
            </span>
          </div>
          <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-breathe`}
               style={relayerAPI.isConnected ? { boxShadow: '0 0 8px rgba(16,185,129,0.5)' } : { boxShadow: '0 0 8px rgba(239,68,68,0.5)' }} />
        </div>
      </div>
    </div>
  );
}

// ─── Home View ───
function HomeView({ navigate, relayerAPI }: { navigate: NavigateFunction, relayerAPI: any }) {
  return (
    <div className="px-4 py-6 pb-28 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-5">
        
        {/* Title section */}
        <div className="animate-fade-in">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1">Dashboard</p>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Control Center</h2>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 animate-fade-in stagger-1">
          <div className="card-elevated p-4 text-center">
            <div className="stat-number text-2xl font-bold text-[var(--champagne)] mb-1">
              {relayerAPI.availableModels.length}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Nodes Online
            </div>
          </div>
          <div className="card-elevated p-4 text-center">
            <div className="stat-number text-2xl font-bold text-[var(--champagne)] mb-1">
              0
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Tasks Run
            </div>
          </div>
        </div>

        {/* Action cards */}
        <div className="space-y-3 animate-fade-in stagger-2">
          {/* Primary CTA */}
          <button 
            onClick={() => navigate('/chat')}
            className="group w-full card-interactive p-5 text-left"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--champagne)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl pointer-events-none" />
            <div className="flex items-center justify-between relative">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Run Compute Task</h3>
                <p className="text-xs text-[var(--text-muted)]">Submit private tasks to GPU nodes</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--champagne)', boxShadow: '0 4px 16px rgba(181,160,130,0.3)' }}>
                <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
            </div>
          </button>

          {/* Secondary CTA */}
          <button 
            onClick={() => navigate('/nft')}
            className="group w-full card-interactive p-5 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Mint NFTs</h3>
                <p className="text-xs text-[var(--text-muted)]">Turn compute results into on-chain assets</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-interactive)', border: '1px solid var(--border-subtle)' }}>
                <svg className="w-5 h-5 text-[var(--cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              </div>
            </div>
          </button>

          {/* Tertiary */}
          <button 
            onClick={() => navigate('/dashboard')}
            className="group w-full card-interactive p-5 text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Dashboard</h3>
                <p className="text-xs text-[var(--text-muted)]">Wallet balance and network status</p>
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-interactive)', border: '1px solid var(--border-subtle)' }}>
                <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* Network status row */}
        <div className="card-elevated p-3 animate-fade-in stagger-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-breathe`} />
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {relayerAPI.isConnected ? 'Network Active' : 'Network Offline'}
              </span>
            </div>
            <span className="text-xs font-mono text-[var(--text-disabled)]">Starknet L2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NFT View ───
function NFTView({ navigate }: { navigate: NavigateFunction }) {
  return (
    <div className="px-4 py-6 pb-28 overflow-y-auto">
      <div className="max-w-md mx-auto">
        <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1 animate-fade-in">Gallery</p>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-6 animate-fade-in">NFT Collection</h2>
        
        <div className="card-elevated p-8 text-center animate-slide-up">
          {/* Geometric placeholder */}
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-interactive)', border: '1px solid var(--border-subtle)' }}>
            <svg className="w-8 h-8 text-[var(--text-disabled)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </div>
          
          <h3 className="font-semibold text-[var(--text-primary)] mb-2">Mint Compute Results</h3>
          <p className="text-sm text-[var(--text-muted)] mb-6 leading-relaxed">
            Turn computed outputs into verified NFTs on Starknet
          </p>
          
          <button 
            onClick={() => navigate('/chat')}
            className="px-6 py-3 rounded-xl bg-[var(--champagne)] hover:bg-[var(--champagne-hover)] text-black font-semibold transition-all duration-200 glow-champagne hover:glow-champagne-strong"
          >
            Start Creating
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ───
function DashboardView({ connectedWallet, relayerAPI }: { connectedWallet: ConnectedWallet, relayerAPI: any }) {
  return (
    <div className="px-4 py-6 pb-28 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-5">
        <div className="animate-fade-in">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1">Account</p>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard</h2>
        </div>
        
        {/* Balance card */}
        <div className="card-elevated p-5 animate-fade-in stagger-1">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-3">Wallet Balance</p>
          <div className="flex items-baseline space-x-2">
            <span className="stat-number text-3xl font-bold text-[var(--champagne)]">
              {connectedWallet.balance_strk}
            </span>
            <span className="text-sm font-mono text-[var(--text-muted)]">STRK</span>
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="text-xs font-mono text-[var(--text-disabled)]">
              {connectedWallet.address.slice(0, 10)}...{connectedWallet.address.slice(-8)}
            </div>
          </div>
        </div>

        {/* Network status */}
        <div className="card-elevated p-5 animate-fade-in stagger-2">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-3">Network</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Relayer</span>
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-mono ${relayerAPI.isConnected ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                  {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-breathe`} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Compute Nodes</span>
              <span className="text-sm font-mono text-[var(--text-primary)]">{relayerAPI.availableModels.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Chain</span>
              <span className="text-sm font-mono text-[var(--text-muted)]">Starknet L2</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bottom Navigation (Floating Glassmorphism) ───
function BottomNavigation({ currentView, navigate }: { currentView: string, navigate: NavigateFunction }) {
  const tabs = [
    { id: 'home', label: 'Home', path: '/home', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    )},
    { id: 'chat', label: 'Compute', path: '/chat', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
      </svg>
    )},
    { id: 'nft', label: 'NFTs', path: '/nft', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    )},
    { id: 'dashboard', label: 'Stats', path: '/dashboard', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    )},
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 p-3 safe-area-bottom" style={{ zIndex: 50 }}>
      <div className="max-w-md mx-auto">
        <div className="glass-nav rounded-2xl p-1.5">
          <div className="flex">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => navigate(tab.path)}
                className={`relative flex-1 flex flex-col items-center py-2.5 rounded-xl transition-all duration-300 group ${
                  currentView === tab.id
                    ? 'bg-gradient-to-t from-[rgba(181,160,130,0.15)] to-transparent'
                    : 'hover:bg-white/5'
                }`}
              >
                {/* Active indicator dot */}
                {currentView === tab.id && (
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 tab-active-dot" />
                )}
                
                <div className={`mb-1 transition-all duration-300 ${
                  currentView === tab.id 
                    ? 'text-[var(--champagne)]' 
                    : 'text-zinc-500 group-hover:text-zinc-300'
                }`} style={currentView === tab.id ? { filter: 'drop-shadow(0 0 6px rgba(181,160,130,0.4))' } : undefined}>
                  {tab.icon}
                </div>
                
                <span className={`text-[10px] font-mono uppercase tracking-wider transition-all duration-300 ${
                  currentView === tab.id 
                    ? 'text-[var(--champagne)] font-medium' 
                    : 'text-zinc-500 group-hover:text-zinc-300'
                }`}>
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
