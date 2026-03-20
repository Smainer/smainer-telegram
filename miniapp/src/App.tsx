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
        <div className="card p-6 text-center">
          <h3 className="text-base font-semibold text-white mb-2">Connect Page Required</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Connect wallet on dedicated page, then return here.
          </p>
          <a
            href={getConnectPageUrl()}
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold transition-all duration-200"
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

// S-Logo SVG Component (the actual compute blocks pattern)
function SLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      {/* S-formation of compute blocks */}
      <rect x="8" y="6" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="18" y="6" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="28" y="6" width="8" height="6" rx="2" fill="#3B82F6" />
      <rect x="18" y="14" width="8" height="6" rx="2" fill="#3B82F6" />
      <rect x="28" y="14" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="8" y="22" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="18" y="22" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="4" y="30" width="8" height="6" rx="2" fill="#FFFFFF" />
      <rect x="14" y="30" width="8" height="6" rx="2" fill="#3B82F6" />
    </svg>
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
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: '#09090B' }}>
        <div className="flex items-center justify-center mb-4">
          <SLogo size={48} />
        </div>
        <h1 className="text-xl font-mono font-semibold text-white tracking-tight mb-6">
          SMAINER
        </h1>
        <div className="flex space-x-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-white loading-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-white loading-dot" />
          <div className="w-1.5 h-1.5 rounded-full bg-white loading-dot" />
        </div>
      </div>
    );
  }

  // ─── Not Connected — Onboarding ───
  if (!connectedWallet) {
    return (
      <main className="min-h-screen p-4" style={{ background: '#09090B' }}>
        <div className="max-w-md mx-auto pt-12">
          {/* Hero */}
          <div className="text-center mb-8 animate-fade-in">
            <div className="flex items-center justify-center mb-6">
              <SLogo size={64} />
            </div>
            <h1 className="text-2xl font-mono font-semibold text-white tracking-tight mb-3">
              SMAINER
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Private compute on Starknet
            </p>
          </div>

          {/* User info card */}
          {tgUser && (
            <div className="card p-4 mb-6 animate-fade-in stagger-1">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--surface-interactive)] border border-[var(--border-subtle)]">
                  <span className="text-sm font-mono font-semibold text-[#3B82F6]">
                    {displayInitial}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-white text-sm">
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
          <div className="mt-6 card p-3 animate-fade-in stagger-3">
            <div className="flex items-center justify-center space-x-2 text-xs">
              <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-pulse-glow`} />
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
    <main className="min-h-screen flex flex-col" style={{ background: '#09090B' }}>
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
      
      {/* Bottom Navigation */}
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
    <div className="px-4 py-3 border-b border-[var(--border-subtle)]" style={{ background: '#09090B' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <SLogo size={20} />
            <h1 className="text-base font-mono font-semibold text-white tracking-tight">
              SMAINER
            </h1>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="px-2.5 py-1 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)]">
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
            </span>
          </div>
          <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-pulse-glow`} />
        </div>
      </div>
    </div>
  );
}

// ─── Home View ───
function HomeView({ navigate, relayerAPI }: { navigate: NavigateFunction, relayerAPI: any }) {
  return (
    <div className="px-4 py-6 pb-24 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-6">
        
        {/* Title section */}
        <div className="animate-fade-in">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1">Dashboard</p>
          <h2 className="text-xl font-semibold text-white">Control Center</h2>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 animate-fade-in stagger-1">
          <div className="card p-5 text-center">
            <div className="stat-number text-3xl font-bold text-white mb-2">
              {relayerAPI.availableModels.length}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Nodes Online
            </div>
          </div>
          <div className="card p-5 text-center">
            <div className="stat-number text-3xl font-bold text-white mb-2">
              0
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              Tasks Run
            </div>
          </div>
        </div>

        {/* Action cards */}
        <div className="space-y-3 animate-fade-in stagger-2">
          {/* Primary CTA - Run Compute Task */}
          <button 
            onClick={() => navigate('/chat')}
            className="group w-full card-interactive p-5 text-left border-l-4 border-l-[#3B82F6]"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white mb-1">Run Compute Task</h3>
                <p className="text-xs text-[var(--text-muted)]">Submit private tasks to GPU nodes</p>
              </div>
              <div className="w-10 h-10 min-w-[40px] rounded-xl flex items-center justify-center bg-[#3B82F6]">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="2" y="4" width="16" height="10" rx="2" fill="white" />
                  <rect x="4" y="6" width="8" height="1" rx="0.5" fill="#3B82F6" />
                  <rect x="4" y="8" width="6" height="1" rx="0.5" fill="#3B82F6" />
                  <circle cx="15" cy="7" r="1" fill="#3B82F6" />
                </svg>
              </div>
            </div>
          </button>

          {/* Secondary CTA - Mint NFTs */}
          <button 
            onClick={() => navigate('/nft')}
            className="group w-full card-interactive p-5 text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white mb-1">Mint NFTs</h3>
                <p className="text-xs text-[var(--text-muted)]">Turn compute results into on-chain assets</p>
              </div>
              <div className="w-10 h-10 min-w-[40px] rounded-xl flex items-center justify-center bg-[var(--surface-interactive)] border border-[var(--border-subtle)]">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="3" width="6" height="6" rx="1" fill="white" />
                  <rect x="11" y="3" width="6" height="6" rx="1" fill="white" />
                  <rect x="3" y="11" width="6" height="6" rx="1" fill="white" />
                  <rect x="11" y="11" width="6" height="6" rx="1" fill="#3B82F6" />
                </svg>
              </div>
            </div>
          </button>

          {/* Tertiary - Dashboard */}
          <button 
            onClick={() => navigate('/dashboard')}
            className="group w-full card-interactive p-5 text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white mb-1">Dashboard</h3>
                <p className="text-xs text-[var(--text-muted)]">Wallet balance and network status</p>
              </div>
              <div className="w-10 h-10 min-w-[40px] rounded-xl flex items-center justify-center bg-[var(--surface-interactive)] border border-[var(--border-subtle)]">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="10" width="3" height="6" rx="1" fill="white" />
                  <rect x="8.5" y="7" width="3" height="9" rx="1" fill="white" />
                  <rect x="14" y="4" width="3" height="12" rx="1" fill="white" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* Network status row */}
        <div className="card p-4 animate-fade-in stagger-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-pulse-glow`} />
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
    <div className="px-4 py-6 pb-24 overflow-y-auto">
      <div className="max-w-md mx-auto">
        <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1 animate-fade-in">Gallery</p>
        <h2 className="text-xl font-semibold text-white mb-6 animate-fade-in">NFT Collection</h2>
        
        <div className="card p-8 text-center animate-slide-up">
          {/* NFT placeholder icon */}
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center bg-[var(--surface-interactive)] border border-[var(--border-subtle)]">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="4" y="4" width="10" height="10" rx="2" fill="white" />
              <rect x="18" y="4" width="10" height="10" rx="2" fill="white" />
              <rect x="4" y="18" width="10" height="10" rx="2" fill="white" />
              <rect x="18" y="18" width="10" height="10" rx="2" fill="#3B82F6" />
            </svg>
          </div>
          
          <h3 className="font-semibold text-white mb-2">Mint Compute Results</h3>
          <p className="text-sm text-[var(--text-muted)] mb-6 leading-relaxed">
            Turn computed outputs into verified NFTs on Starknet
          </p>
          
          <button 
            onClick={() => navigate('/chat')}
            className="px-6 py-3 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold transition-all duration-200"
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
    <div className="px-4 py-6 pb-24 overflow-y-auto">
      <div className="max-w-md mx-auto space-y-5">
        <div className="animate-fade-in">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1">Account</p>
          <h2 className="text-xl font-semibold text-white">Dashboard</h2>
        </div>
        
        {/* Balance card */}
        <div className="card p-5 animate-fade-in stagger-1">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-3">Wallet Balance</p>
          <div className="flex items-baseline space-x-2">
            <span className="stat-number text-3xl font-bold text-white">
              {connectedWallet.balance_strk}
            </span>
            <span className="text-sm font-mono text-[var(--text-muted)]">STRK</span>
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <div className="text-xs font-mono text-[var(--text-disabled)]">
              {connectedWallet.address.slice(0, 10)}...{connectedWallet.address.slice(-8)}
            </div>
          </div>
        </div>

        {/* Network status */}
        <div className="card p-5 animate-fade-in stagger-2">
          <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)] mb-3">Network</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Relayer</span>
              <div className="flex items-center space-x-2">
                <span className={`text-sm font-mono ${relayerAPI.isConnected ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                  {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                </span>
                <div className={`w-1.5 h-1.5 rounded-full ${relayerAPI.isConnected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'} animate-pulse-glow`} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Compute Nodes</span>
              <span className="text-sm font-mono text-white">{relayerAPI.availableModels.length}</span>
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

// ─── Bottom Navigation ───
function BottomNavigation({ currentView, navigate }: { currentView: string, navigate: NavigateFunction }) {
  const tabs = [
    { 
      id: 'home', 
      label: 'Home', 
      path: '/home', 
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" />
        </svg>
      )
    },
    { 
      id: 'chat', 
      label: 'Compute', 
      path: '/chat', 
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="2" y="4" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <rect x="4" y="6" width="8" height="1" rx="0.5" fill="currentColor" />
          <rect x="4" y="8" width="6" height="1" rx="0.5" fill="currentColor" />
          <circle cx="15" cy="7" r="1" fill="currentColor" />
        </svg>
      )
    },
    { 
      id: 'nft', 
      label: 'NFTs', 
      path: '/nft', 
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="11" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="11" width="6" height="6" rx="1" />
          <rect x="11" y="11" width="6" height="6" rx="1" />
        </svg>
      )
    },
    { 
      id: 'dashboard', 
      label: 'Stats', 
      path: '/dashboard', 
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <rect x="3" y="10" width="3" height="6" rx="1" />
          <rect x="8.5" y="7" width="3" height="9" rx="1" />
          <rect x="14" y="4" width="3" height="12" rx="1" />
        </svg>
      )
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 safe-area-bottom">
      <div className="bg-[#09090B] border-t border-[var(--border-subtle)] px-4 py-2">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`relative flex-1 flex flex-col items-center py-2 transition-all duration-200 ${
                currentView === tab.id ? '' : 'opacity-60 hover:opacity-80'
              }`}
            >
              <div className={`mb-1 transition-colors duration-200 ${
                currentView === tab.id 
                  ? 'text-[#3B82F6]' 
                  : 'text-[var(--text-muted)]'
              }`}>
                {tab.icon}
              </div>
              
              <span className={`text-[10px] font-mono transition-colors duration-200 ${
                currentView === tab.id 
                  ? 'text-[#3B82F6] font-medium' 
                  : 'text-[var(--text-muted)]'
              }`}>
                {tab.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
