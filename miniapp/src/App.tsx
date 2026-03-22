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
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;

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
        <div className="glass p-6 text-center">
          <h3 className="text-lg font-semibold text-white mb-2">Connect Wallet</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Open the dedicated connect page for best compatibility.
          </p>
          <a
            href={getConnectPageUrl()}
            target="_blank" 
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Connect Wallet
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ICONS
   ═══════════════════════════════════════════════════════════════════════════ */

function IconHome({ active }: { active?: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path 
        d="M3 12L12 4L21 12" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M5 10V19C5 19.5523 5.44772 20 6 20H9V15C9 14.4477 9.44772 14 10 14H14C14.5523 14 15 14.4477 15 15V20H18C18.5523 20 19 19.5523 19 19V10" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'}
      />
    </svg>
  );
}

function IconCompute({ active }: { active?: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect 
        x="3" y="6" width="18" height="12" rx="2" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2"
        fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'}
      />
      <path d="M7 10H12" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round"/>
      <path d="M7 14H10" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="17" cy="12" r="2" fill={active ? '#3B82F6' : 'currentColor'} />
    </svg>
  );
}

function IconNFT({ active }: { active?: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="7" height="7" rx="2" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'} />
      <rect x="13" y="4" width="7" height="7" rx="2" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'} />
      <rect x="4" y="13" width="7" height="7" rx="2" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'} />
      <rect x="13" y="13" width="7" height="7" rx="2" fill={active ? '#3B82F6' : 'currentColor'} />
    </svg>
  );
}

function IconStats({ active }: { active?: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="12" width="4" height="8" rx="1" fill={active ? '#3B82F6' : 'currentColor'} opacity={active ? 1 : 0.6} />
      <rect x="10" y="8" width="4" height="12" rx="1" fill={active ? '#3B82F6' : 'currentColor'} opacity={active ? 1 : 0.8} />
      <rect x="16" y="4" width="4" height="16" rx="1" fill={active ? '#3B82F6' : 'currentColor'} />
    </svg>
  );
}

function SmainerLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 80 312 352" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Official: 7 compute blocks in distributed S-formation */}
      <rect x="200" y="104" width="112" height="48" rx="8" fill="#FFFFFF" />
      <rect x="328" y="104" width="48" height="48" rx="8" fill="#3B82F6" />
      <rect x="136" y="168" width="48" height="48" rx="8" fill="#FFFFFF" />
      <rect x="200" y="232" width="112" height="48" rx="8" fill="#FFFFFF" />
      <rect x="328" y="296" width="48" height="48" rx="8" fill="#FFFFFF" />
      <rect x="136" y="360" width="48" height="48" rx="8" fill="#3B82F6" />
      <rect x="200" y="360" width="112" height="48" rx="8" fill="#FFFFFF" />
    </svg>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/home" element={<MainApp />} />
      <Route path="/chat" element={<MainApp />} />
      <Route path="/nft" element={<MainApp />} />
      <Route path="/dashboard" element={<MainApp />} />
      <Route path="*" element={<MainApp />} />
    </Routes>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════════════════ */

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(() => loadPersistedWallet());
  
  // Default to 'home' for root path or empty path
  const pathView = location.pathname.replace('/', '') || 'home';
  const currentView = pathView as 'home' | 'chat' | 'nft' | 'dashboard';

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
  const displayInitial = displayFirstName ? displayFirstName.charAt(0).toUpperCase() : '?';
  const displayUsername = tgUser?.username || (tgUser?.id ? `user${tgUser.id}` : 'user');
  
  const relayerAPI = useRelayerAPI({
    baseUrl: import.meta.env.VITE_RELAYER_URL || 'https://api.smainer.io',
    // NOTE: api.smainer.ai does not resolve yet — fallback uses api.smainer.io (138.197.11.147)
    walletAddress: connectedWallet?.address,
  });

  useEffect(() => {
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
    
    // Shorter loading for better UX
    const timer = setTimeout(() => setIsLoading(false), 600);
    return () => clearTimeout(timer);
  }, [miniApp, isInTelegram]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (connectedWallet) {
      window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(connectedWallet));
    } else {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  }, [connectedWallet]);

  // Cross-tab wallet sync
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
    } catch { /* BroadcastChannel not supported */ }

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
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleWalletConnect = (wallet: ConnectedWallet) => {
    setConnectedWallet(wallet);
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));

    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({ action: 'wallet_connect', address: wallet.address, wallet_type: wallet.type });
      channel.close();
    } catch { /* ignore */ }

    navigate('/chat');
  };

  const handleWalletDisconnect = () => {
    setConnectedWallet(null);
    navigate('/');
    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({ action: 'wallet_disconnect' });
      channel.close();
    } catch { /* ignore */ }
  };

  const handleSubmitInferenceTask = async (request: InferenceRequest): Promise<string> => {
    const taskId = await relayerAPI.submitInferenceTask(request);
    console.log('Task submitted:', taskId);
    return taskId;
  };

  // ─── Loading Screen ───
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--void)]">
        <div className="animate-in delay-1">
          <SmainerLogo size={64} />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white animate-in delay-2">SMAINER</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)] animate-in delay-3">Private Compute</p>
        <div className="mt-8 flex gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--blue)] loading-dot" />
          <div className="w-2 h-2 rounded-full bg-[var(--blue)] loading-dot" />
          <div className="w-2 h-2 rounded-full bg-[var(--blue)] loading-dot" />
        </div>
      </div>
    );
  }

  // ─── Onboarding (Not Connected) ───
  if (!connectedWallet) {
    return (
      <main className="min-h-screen bg-[var(--void)]">
        {/* Hero Glow */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[var(--blue)] opacity-10 blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-md mx-auto" style={{ padding: '48px 20px 100px 20px', minHeight: '100vh', overflowY: 'auto' }}>
          {/* Logo & Title */}
          <div style={{ textAlign: 'center', marginBottom: 40 }} className="animate-in">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <SmainerLogo size={72} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', marginBottom: 8 }}>SMAINER</h1>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Private compute on Starknet</p>
          </div>

          {/* User Card (if in Telegram) */}
          {tgUser && (
            <div className="glass animate-in delay-1" style={{ padding: 20, marginBottom: 24, borderRadius: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>{displayInitial}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayFirstName} {displayLastName}
                  </p>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{displayUsername}</p>
                </div>
              </div>
            </div>
          )}

          {/* Wallet Connect */}
          <div style={{ marginBottom: 24 }} className="animate-in delay-2">
            <WalletSectionBoundary>
              <WalletConnect 
                onConnect={handleWalletConnect}
                onDisconnect={handleWalletDisconnect}
              />
            </WalletSectionBoundary>
          </div>

          {/* Network Status */}
          <div style={{ marginTop: 'auto', paddingTop: 16, paddingBottom: 16, paddingLeft: 4, paddingRight: 4 }} className="animate-in delay-3">
            <div className="glass" style={{ padding: 16, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    backgroundColor: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)',
                    boxShadow: relayerAPI.isConnected ? '0 0 8px var(--success)' : 'none'
                  }} />
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                    {relayerAPI.isConnected ? 'Network Online' : relayerAPI.error ? 'Network Offline' : 'Connecting...'}
                  </span>
                </div>
                {relayerAPI.availableModels.length > 0 && (
                  <span className="pill">
                    {relayerAPI.availableModels.length} node{relayerAPI.availableModels.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <NavBar currentView="home" navigate={navigate} />
      </main>
    );
  }

  // ─── Main App (Connected) ───
  return (
    <main className="min-h-screen flex flex-col bg-[var(--void)]">
      {/* Header */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--void)' }}>
        <div style={{ maxWidth: 448, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SmainerLogo size={28} />
            <span style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>SMAINER</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pill">
              {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
            </div>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)',
              boxShadow: relayerAPI.isConnected ? '0 0 8px var(--success)' : 'none'
            }} />
          </div>
        </div>
      </header>
      
      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {currentView === 'home' && <HomeView navigate={navigate} relayerAPI={relayerAPI} />}
        {currentView === 'chat' && (
          <ChatInterface
            walletAddress={connectedWallet.address}
            availableModels={relayerAPI.availableModels}
            onSubmitTask={handleSubmitInferenceTask}
          />
        )}
        {currentView === 'nft' && <NFTView navigate={navigate} />}
        {currentView === 'dashboard' && <DashboardView connectedWallet={connectedWallet} relayerAPI={relayerAPI} onDisconnect={handleWalletDisconnect} />}
      </div>
      
      {/* Navigation */}
      <NavBar currentView={currentView} navigate={navigate} />
    </main>
  );
}
/* ═══════════════════════════════════════════════════════════════════════════
   HOME VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

function HomeView({ navigate, relayerAPI }: { navigate: NavigateFunction, relayerAPI: any }) {
  const nodesOnline = relayerAPI.availableModels.length;
  
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Header */}
        <div className="animate-in">
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-hint)', marginBottom: 4 }}>Dashboard</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'white' }}>Control Center</h2>
        </div>

        {/* Stats Row */}
        <div className="animate-in delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="glass" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'white', marginBottom: 4 }}>{nodesOnline}</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-hint)' }}>Nodes Online</div>
          </div>
          <div className="glass" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'white', marginBottom: 4 }}>0</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-hint)' }}>Tasks Run</div>
          </div>
        </div>

        {/* Primary CTA */}
        <button 
          onClick={() => navigate('/chat')}
          className="card-interactive animate-in delay-2"
          style={{ padding: 20, textAlign: 'left', borderLeft: '3px solid var(--blue)', width: '100%' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'white', marginBottom: 4 }}>Run Compute Task</h3>
              <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Submit private inference to GPU nodes</p>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)' }}>
              <IconCompute active />
            </div>
          </div>
          {nodesOnline > 0 && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
              <span style={{ fontSize: 14, color: 'var(--success)' }}>{nodesOnline} node{nodesOnline !== 1 ? 's' : ''} ready</span>
            </div>
          )}
        </button>

        {/* Secondary Actions */}
        <div className="animate-in delay-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <button 
            onClick={() => navigate('/nft')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left' }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-glass)', marginBottom: 12 }}>
              <IconNFT />
            </div>
            <h4 style={{ fontWeight: 600, color: 'white', marginBottom: 4 }}>Marketplace</h4>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Browse & mint NFTs</p>
          </button>
          
          <button 
            onClick={() => navigate('/dashboard')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left' }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-glass)', marginBottom: 12 }}>
              <IconStats />
            </div>
            <h4 style={{ fontWeight: 600, color: 'white', marginBottom: 4 }}>Dashboard</h4>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Balance & status</p>
          </button>
        </div>

        {/* Network Status */}
        <div className="glass animate-in delay-4" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)',
                boxShadow: relayerAPI.isConnected ? '0 0 8px var(--success)' : 'none'
              }} />
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {relayerAPI.isConnected ? 'Network Active' : 'Connecting...'}
              </span>
            </div>
            <span className="pill">Starknet L2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NFT VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

function NFTView({ navigate }: { navigate: NavigateFunction }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto' }}>
        {/* Header */}
        <div className="mb-8 animate-in">
          <p className="text-label mb-1">Marketplace</p>
          <h2 className="text-2xl font-bold text-white">Marketplace</h2>
        </div>
        
        {/* Empty State */}
        <div className="glass p-8 text-center animate-in delay-1">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center bg-[var(--surface-glass)]">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="6" y="6" width="12" height="12" rx="3" fill="white" opacity="0.6" />
              <rect x="22" y="6" width="12" height="12" rx="3" fill="white" opacity="0.6" />
              <rect x="6" y="22" width="12" height="12" rx="3" fill="white" opacity="0.6" />
              <rect x="22" y="22" width="12" height="12" rx="3" fill="var(--blue)" />
            </svg>
          </div>
          
          <h3 className="text-xl font-semibold text-white mb-2">Mint Compute Results</h3>
          <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
            Turn your AI-generated outputs into verified NFTs on Starknet
          </p>
          
          <button onClick={() => navigate('/chat')} className="btn btn-primary w-full">
            Start Creating
          </button>
        </div>
        
        {/* Info Card */}
        <div className="glass p-4 mt-6 animate-in delay-2">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--blue)] bg-opacity-20 flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--blue)">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5a1 1 0 112 0v3a1 1 0 01-2 0V5zm1 7a1 1 0 100-2 1 1 0 000 2z"/>
              </svg>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Each NFT includes cryptographic proof of the compute task that generated it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

function DashboardView({ 
  connectedWallet, 
  relayerAPI, 
  onDisconnect 
}: { 
  connectedWallet: ConnectedWallet
  relayerAPI: any
  onDisconnect: () => void
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto' }}>
        <div className="space-y-6">
        {/* Header */}
        <div className="animate-in">
          <p className="text-label mb-1">Account</p>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        </div>
        
        {/* Balance Card */}
        <div className="glass p-6 animate-in delay-1">
          <p className="text-label mb-4">Wallet Balance</p>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-stat text-5xl text-white">{connectedWallet.balance_strk || '0'}</span>
            <span className="text-lg text-[var(--text-muted)]">STRK</span>
          </div>
          <div className="pt-4 border-t border-[var(--border-subtle)]">
            <p className="text-mono text-sm text-[var(--text-muted)] break-all">
              {connectedWallet.address}
            </p>
          </div>
        </div>

        {/* Network Status */}
        <div className="glass p-5 animate-in delay-2">
          <p className="text-label mb-4">Network Status</p>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Relayer</span>
              <div className="status">
                <span className={`text-sm font-medium ${relayerAPI.isConnected ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                  {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                </span>
                <div className={`status-dot ${relayerAPI.isConnected ? 'status-dot-online animate-glow' : 'status-dot-offline'}`} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Compute Nodes</span>
              <span className="text-white font-medium">{relayerAPI.availableModels.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Chain</span>
              <span className="pill">Starknet L2</span>
            </div>
          </div>
        </div>

        {/* Disconnect */}
        <button 
          onClick={onDisconnect}
          className="w-full btn btn-ghost text-[var(--error)] animate-in delay-3"
        >
          Disconnect Wallet
        </button>
      </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVIGATION BAR
   ═══════════════════════════════════════════════════════════════════════════ */

function NavBar({ currentView, navigate }: { currentView: string, navigate: NavigateFunction }) {
  const tabs = [
    { id: 'home', label: 'Home', path: '/', Icon: IconHome },
    { id: 'chat', label: 'Compute', path: '/chat', Icon: IconCompute },
    { id: 'nft', label: 'Market', path: '/nft', Icon: IconNFT },
    { id: 'dashboard', label: 'Stats', path: '/dashboard', Icon: IconStats },
  ];

  return (
    <nav className="nav-bar safe-area-bottom">
      <div className="nav-bar-inner">
        {tabs.map(({ id, label, path, Icon }) => {
          const isActive = currentView === id;
          return (
            <button
              key={id}
              onClick={() => navigate(path)}
              className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
              style={{ flex: 1 }}
            >
              <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon active={isActive} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: isActive ? 'var(--blue)' : 'var(--text-muted)' }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
