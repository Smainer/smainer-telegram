import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, NavigateFunction } from 'react-router-dom';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { DebugOverlay, addDebugBootStep } from './components/DebugOverlay';
import { AnimatedLogo } from './components/AnimatedLogo';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import { useTelegramData } from './hooks/useTelegramData';
import type { ConnectedWallet, InferenceRequest } from './types';

const WALLET_STORAGE_KEY = 'smainer_connected_wallet';

function getConnectPageUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/connect`;
  }
  return (import.meta.env.VITE_FRONTEND_URL || 'https://app.smainer.io') + '/connect';
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
        <div className="glass" style={{ padding: '24px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'white', marginBottom: '8px' }}>Connect Wallet</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
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
  const [botWalletChecked, setBotWalletChecked] = useState(false);
  
  // Default to 'home' for root path or empty path
  const pathView = location.pathname.replace('/', '') || 'home';
  const currentView = pathView as 'home' | 'chat' | 'nft' | 'dashboard';

  const { initData, initDataRaw, miniApp, isInTelegram } = useTelegramData();
  const botApiUrl = import.meta.env.VITE_BOT_API_URL || 'https://bot.smainer.io';
  
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

  // Check if user already has a linked wallet via the bot
  useEffect(() => {
    const checkBotWallet = async () => {
      // Skip if we already have a wallet or if not in Telegram
      if (connectedWallet || !isInTelegram || !initDataRaw) {
        setBotWalletChecked(true);
        return;
      }

      try {
        const response = await fetch(
          `${botApiUrl}/api/wallet-check?initData=${encodeURIComponent(initDataRaw)}`,
          { method: 'GET' }
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.linked && data.address) {
            // User already has a linked wallet via bot - apply it
            const wallet: ConnectedWallet = {
              address: data.address,
              type: 'bot-linked',
              balance_strk: '0',
              balance_smainer: '0',
            };
            setConnectedWallet(wallet);
            addDebugBootStep('bot_wallet_found', 'success', data.address.slice(0, 10) + '...');
          }
        }
      } catch (err) {
        console.log('Could not check bot wallet state:', err);
        // Non-fatal - continue with normal flow
      } finally {
        setBotWalletChecked(true);
      }
    };

    checkBotWallet();
  }, [isInTelegram, initDataRaw, botApiUrl, connectedWallet]);

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

    navigate('/chat', { replace: true });
  };

  const handleWalletDisconnect = () => {
    setConnectedWallet(null);
    navigate('/', { replace: true });
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
      <div style={{ 
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#09090B'
      }}>
        <div className="animate-in delay-1">
          <AnimatedLogo size={64} />
        </div>
        <h1 className="animate-in delay-2" style={{ marginTop: 24, fontSize: 24, fontWeight: 700, color: '#FFFFFF' }}>SMAINER</h1>
        <p className="animate-in delay-3" style={{ marginTop: 8, fontSize: 14, color: '#71717A' }}>Private Compute</p>
        <div style={{ marginTop: 32, display: 'flex', gap: 8 }}>
          <div className="loading-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6' }} />
          <div className="loading-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6' }} />
          <div className="loading-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6' }} />
        </div>
      </div>
    );
  }

  // ─── Onboarding (Not Connected) ───
  if (!connectedWallet) {
    return (
      <main style={{ minHeight: '100vh', background: '#09090B' }}>
        {/* Hero Glow */}
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ 
            position: 'absolute', 
            top: 0, 
            left: '50%', 
            transform: 'translateX(-50%)', 
            width: 600, 
            height: 400, 
            background: 'radial-gradient(circle, #3B82F6 0%, rgba(59, 130, 246, 0.4) 30%, transparent 70%)',
            opacity: 0.15, 
            filter: 'blur(80px)' 
          }} />
        </div>

        <div style={{ position: 'relative', zIndex: 10, maxWidth: 448, margin: '0 auto', padding: '48px 20px 100px 20px', minHeight: '100vh', overflowY: 'auto' }}>
          {/* Logo & Title */}
          <div style={{ textAlign: 'center', marginBottom: 40 }} className="animate-in">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <AnimatedLogo size={72} />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.02em', marginBottom: 8 }}>SMAINER</h1>
            <p style={{ fontSize: 15, color: '#A1A1AA' }}>Private compute on Starknet</p>
          </div>

          {/* User Card (if in Telegram) */}
          {tgUser && (
            <div className="glass animate-in delay-1" style={{ padding: 20, marginBottom: 24, borderRadius: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF' }}>{displayInitial}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                    {displayFirstName} {displayLastName}
                  </p>
                  <p style={{ fontSize: 14, color: '#71717A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>@{displayUsername}</p>
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
          <div style={{ marginTop: 'auto', paddingTop: 16, paddingBottom: 16 }} className="animate-in delay-3">
            <div className="glass" style={{ padding: 16, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    backgroundColor: relayerAPI.isConnected ? '#22C55E' : '#EF4444',
                    boxShadow: relayerAPI.isConnected ? '0 0 8px #22C55E' : 'none'
                  }} />
                  <span style={{ fontSize: 14, color: '#71717A' }}>
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
        {/* NavBar intentionally omitted during onboarding — keep the connect flow focused */}
      </main>
    );
  }

  // ─── Main App (Connected) ───
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#09090B' }}>
      {/* Header */}
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #27272A', background: '#09090B' }}>
        <div style={{ maxWidth: 448, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AnimatedLogo size={28} />
            <span style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF' }}>SMAINER</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pill">
              {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
            </div>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: relayerAPI.isConnected ? '#22C55E' : '#EF4444',
              boxShadow: relayerAPI.isConnected ? '0 0 8px #22C55E' : 'none'
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
        {currentView === 'nft' && <NFTView navigate={navigate} walletAddress={connectedWallet?.address} />}
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
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A', margin: 0, marginBottom: 4 }}>Dashboard</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#E4E4E7', margin: 0 }}>Control Center</h2>
        </div>

        {/* Stats Row */}
        <div className="animate-in delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="glass" style={{ padding: 20, textAlign: 'center', borderRadius: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#E4E4E7', marginBottom: 4 }}>{nodesOnline}</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A' }}>Nodes Online</div>
          </div>
          <div className="glass" style={{ padding: 20, textAlign: 'center', borderRadius: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#E4E4E7', marginBottom: 4 }}>0</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A' }}>Tasks Run</div>
          </div>
        </div>

        {/* Primary CTA */}
        <button 
          onClick={() => navigate('/chat')}
          className="card-interactive animate-in delay-2"
          style={{ padding: 20, textAlign: 'left', borderLeft: '3px solid #3B82F6', width: '100%', borderRadius: 16 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>Run Compute Task</h3>
              <p style={{ fontSize: 14, color: '#71717A', margin: 0 }}>Submit private inference to GPU nodes</p>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3B82F6' }}>
              <IconCompute active />
            </div>
          </div>
          {nodesOnline > 0 && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 8px #22C55E' }} />
              <span style={{ fontSize: 14, color: '#22C55E' }}>{nodesOnline} node{nodesOnline !== 1 ? 's' : ''} ready</span>
            </div>
          )}
        </button>

        {/* Secondary Actions */}
        <div className="animate-in delay-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <button 
            onClick={() => navigate('/nft')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left', borderRadius: 16 }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#27272A', marginBottom: 12 }}>
              <IconNFT />
            </div>
            <h4 style={{ fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>NFT</h4>
            <p style={{ fontSize: 12, color: '#71717A', margin: 0 }}>Browse & mint NFTs</p>
          </button>
          
          <button 
            onClick={() => navigate('/dashboard')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left', borderRadius: 16 }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#27272A', marginBottom: 12 }}>
              <IconStats />
            </div>
            <h4 style={{ fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>Dashboard</h4>
            <p style={{ fontSize: 12, color: '#71717A', margin: 0 }}>Balance & status</p>
          </button>
        </div>

        {/* Network Status */}
        <div className="glass animate-in delay-4" style={{ padding: 16, borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: relayerAPI.isConnected ? '#22C55E' : '#EF4444',
                boxShadow: relayerAPI.isConnected ? '0 0 8px #22C55E' : 'none'
              }} />
              <span style={{ fontSize: 14, color: '#71717A' }}>
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
   NFT MARKETPLACE VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

// Types for NFT Marketplace
type NFTCategory = 'AiArt' | 'ComputeCredit' | 'ProviderBadge' | 'ComputeCertificate';

interface NFTListing {
  id: string;
  token_id: string;
  category: NFTCategory;
  price: string;
  seller_address: string;
  created_at: string;
  metadata: { name: string; description: string; };
}

interface UserNFT {
  token_id: string;
  category: NFTCategory;
  owner_address: string;
  metadata: { name: string; description: string; };
  is_listed: boolean;
  listing_id?: string;
  listing_price?: string;
}

interface MarketplaceStats {
  total_listed: number;
  total_volume: string;
  floor_price: string;
}

interface MarketplaceActivity {
  id: string;
  type: 'sale' | 'listing' | 'delisting';
  token_id: string;
  category: NFTCategory;
  price?: string;
  from_address?: string;
  to_address?: string;
  timestamp: string;
}

// Category colors
const CATEGORY_COLORS: Record<NFTCategory, string> = {
  AiArt: '#A855F7',
  ComputeCredit: '#3B82F6',
  ProviderBadge: '#F59E0B',
  ComputeCertificate: '#22C55E',
};

const CATEGORY_LABELS: Record<NFTCategory, string> = {
  AiArt: 'AI Art',
  ComputeCredit: 'Compute Credit',
  ProviderBadge: 'Provider Badge',
  ComputeCertificate: 'Compute Certificate',
};

// Truncate address helper
function truncateAddress(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function NFTView({ 
  navigate, 
  walletAddress 
}: { 
  navigate: NavigateFunction; 
  walletAddress?: string;
}) {
  const [activeTab, setActiveTab] = useState<'browse' | 'my-nfts' | 'activity'>('browse');
  const [selectedCategory, setSelectedCategory] = useState<NFTCategory | 'all'>('all');
  const [listings, setListings] = useState<NFTListing[]>([]);
  const [userNfts, setUserNfts] = useState<UserNFT[]>([]);
  const [activities, setActivities] = useState<MarketplaceActivity[]>([]);
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState<NFTListing | null>(null);
  const [selectedNft, setSelectedNft] = useState<UserNFT | null>(null);
  const [listPrice, setListPrice] = useState('');
  const [txPending, setTxPending] = useState(false);
  const [txSuccess, setTxSuccess] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || 'https://api.smainer.io';

  // Fetch marketplace data
  useEffect(() => {
    fetchData();
  }, [activeTab, selectedCategory, walletAddress]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch stats
      const statsRes = await fetch(`${RELAYER_URL}/api/v1/nft/stats/marketplace`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (activeTab === 'browse') {
        const params = new URLSearchParams({ page: '1', per_page: '20' });
        if (selectedCategory !== 'all') {
          const categoryMap: Record<NFTCategory, string> = { 
            AiArt: '0', ComputeCredit: '1', ProviderBadge: '2', ComputeCertificate: '3' 
          };
          params.set('category', categoryMap[selectedCategory]);
        }
        const res = await fetch(`${RELAYER_URL}/api/v1/nft/listings?${params}`);
        if (res.ok) {
          const data = await res.json();
          setListings(data.listings || data || []);
        } else {
          setListings([]);
        }
      } else if (activeTab === 'my-nfts' && walletAddress) {
        const res = await fetch(`${RELAYER_URL}/api/v1/nft/user/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          setUserNfts(data.nfts || data || []);
        } else {
          setUserNfts([]);
        }
      } else if (activeTab === 'activity') {
        // Activity would come from listings endpoint with recent sort
        const res = await fetch(`${RELAYER_URL}/api/v1/nft/listings?sort_by=recent&per_page=20`);
        if (res.ok) {
          const data = await res.json();
          // Transform listings to activity format
          const items = (data.listings || data || []).map((l: NFTListing) => ({
            id: l.id,
            type: 'listing' as const,
            token_id: l.token_id,
            category: l.category,
            price: l.price,
            from_address: l.seller_address,
            timestamp: l.created_at,
          }));
          setActivities(items);
        }
      }
    } catch (err) {
      setError('Failed to load marketplace data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Buy NFT
  const handleBuy = async () => {
    if (!selectedListing || !walletAddress) return;
    setTxPending(true);
    setTxError(null);
    setTxSuccess(null);
    try {
      const res = await fetch(`${RELAYER_URL}/api/v1/nft/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: selectedListing.id,
          buyer_address: walletAddress,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Purchase failed');
      }
      setTxSuccess('NFT purchased successfully!');
      setTimeout(() => {
        setBuyModalOpen(false);
        setTxSuccess(null);
        fetchData();
      }, 2000);
    } catch (err: any) {
      setTxError(err.message || 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  };

  // List NFT for sale
  const handleList = async () => {
    if (!selectedNft || !listPrice || parseFloat(listPrice) <= 0) return;
    setTxPending(true);
    setTxError(null);
    setTxSuccess(null);
    try {
      const res = await fetch(`${RELAYER_URL}/api/v1/nft/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: selectedNft.token_id,
          price: listPrice,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Listing failed');
      }
      setTxSuccess('NFT listed for sale!');
      setTimeout(() => {
        setListModalOpen(false);
        setListPrice('');
        setTxSuccess(null);
        fetchData();
      }, 2000);
    } catch (err: any) {
      setTxError(err.message || 'Failed to list NFT');
    } finally {
      setTxPending(false);
    }
  };

  // Delist NFT
  const handleDelist = async (nft: UserNFT) => {
    if (!nft.listing_id || !walletAddress) return;
    setTxPending(true);
    try {
      const res = await fetch(`${RELAYER_URL}/api/v1/nft/delist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: nft.listing_id,
          owner_address: walletAddress,
        }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Delist failed:', err);
    } finally {
      setTxPending(false);
    }
  };

  const openBuyModal = (listing: NFTListing) => {
    setSelectedListing(listing);
    setTxError(null);
    setTxSuccess(null);
    setBuyModalOpen(true);
  };

  const openListModal = (nft: UserNFT) => {
    setSelectedNft(nft);
    setListPrice('');
    setTxError(null);
    setTxSuccess(null);
    setListModalOpen(true);
  };

  const categories: NFTCategory[] = ['AiArt', 'ComputeCredit', 'ProviderBadge', 'ComputeCertificate'];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto' }}>
        {/* Header */}
        <div className="animate-in" style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 4 }}>Marketplace</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#FFFFFF' }}>NFT</h2>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="glass animate-in delay-1" style={{ padding: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-around' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>{stats.total_listed}</div>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Listed</div>
            </div>
            <div style={{ width: 1, background: '#27272A' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>{stats.total_volume}</div>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volume</div>
            </div>
            <div style={{ width: 1, background: '#27272A' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>{stats.floor_price}</div>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Floor</div>
            </div>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="animate-in delay-1" style={{ display: 'flex', gap: 8, marginBottom: 20, background: '#141416', borderRadius: 12, padding: 4 }}>
          {(['browse', 'my-nfts', 'activity'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === tab ? '#3B82F6' : 'transparent',
                color: activeTab === tab ? '#FFFFFF' : '#A1A1AA',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {tab === 'browse' ? 'Browse' : tab === 'my-nfts' ? 'My NFTs' : 'Activity'}
            </button>
          ))}
        </div>

        {/* Category Filter (Browse tab only) */}
        {activeTab === 'browse' && (
          <div className="animate-in delay-2" style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
            <button
              onClick={() => setSelectedCategory('all')}
              className={selectedCategory === 'all' ? 'pill pill-active' : 'pill'}
              style={{ flexShrink: 0 }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="pill"
                style={{
                  flexShrink: 0,
                  background: selectedCategory === cat ? CATEGORY_COLORS[cat] : undefined,
                  borderColor: selectedCategory === cat ? CATEGORY_COLORS[cat] : undefined,
                  color: selectedCategory === cat ? '#FFFFFF' : undefined,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #27272A', borderTopColor: '#3B82F6', borderRadius: '50%' }} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="glass" style={{ padding: 24, textAlign: 'center' }}>
            <p style={{ color: '#EF4444', marginBottom: 16 }}>{error}</p>
            <button onClick={fetchData} className="btn btn-secondary">Retry</button>
          </div>
        ) : (
          <>
            {/* Browse Tab */}
            {activeTab === 'browse' && (
              <>
                {listings.length === 0 ? (
                  <EmptyState
                    icon="marketplace"
                    title="The marketplace is empty"
                    description="Be the first to list an NFT!"
                    action={{ label: 'Create NFT', onClick: () => navigate('/chat') }}
                  />
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    {listings.map((listing, i) => (
                      <NFTCard
                        key={listing.id}
                        category={listing.category}
                        name={listing.metadata.name}
                        price={listing.price}
                        owner={listing.seller_address}
                        delay={i % 4}
                        actionLabel="Buy"
                        onAction={() => openBuyModal(listing)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* My NFTs Tab */}
            {activeTab === 'my-nfts' && (
              <>
                {!walletAddress ? (
                  <EmptyState
                    icon="wallet"
                    title="Connect your wallet"
                    description="Connect your wallet to view your NFTs"
                  />
                ) : userNfts.length === 0 ? (
                  <EmptyState
                    icon="collection"
                    title="No NFTs yet"
                    description="You don't own any Smainer NFTs yet. Browse the marketplace to find one."
                    action={{ label: 'Browse Marketplace', onClick: () => setActiveTab('browse') }}
                  />
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    {userNfts.map((nft, i) => (
                      <NFTCard
                        key={nft.token_id}
                        category={nft.category}
                        name={nft.metadata.name}
                        price={nft.is_listed ? nft.listing_price : undefined}
                        owner={nft.owner_address}
                        delay={i % 4}
                        isOwned
                        isListed={nft.is_listed}
                        actionLabel={nft.is_listed ? 'Delist' : 'List for Sale'}
                        onAction={() => nft.is_listed ? handleDelist(nft) : openListModal(nft)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Activity Tab */}
            {activeTab === 'activity' && (
              <>
                {activities.length === 0 ? (
                  <EmptyState
                    icon="activity"
                    title="No activity yet"
                    description="Recent marketplace activity will appear here"
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activities.map((activity, i) => (
                      <ActivityItem key={activity.id} activity={activity} delay={i % 5} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Buy Modal */}
        {buyModalOpen && selectedListing && (
          <Modal onClose={() => !txPending && setBuyModalOpen(false)}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              {/* NFT Preview */}
              <div style={{
                width: 120,
                height: 120,
                borderRadius: 16,
                margin: '0 auto 16px',
                background: `linear-gradient(135deg, ${CATEGORY_COLORS[selectedListing.category]}40, ${CATEGORY_COLORS[selectedListing.category]}10)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <rect x="8" y="8" width="14" height="14" rx="4" fill={CATEGORY_COLORS[selectedListing.category]} opacity="0.6" />
                  <rect x="26" y="8" width="14" height="14" rx="4" fill={CATEGORY_COLORS[selectedListing.category]} opacity="0.6" />
                  <rect x="8" y="26" width="14" height="14" rx="4" fill={CATEGORY_COLORS[selectedListing.category]} opacity="0.6" />
                  <rect x="26" y="26" width="14" height="14" rx="4" fill={CATEGORY_COLORS[selectedListing.category]} />
                </svg>
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: '#FFFFFF', marginBottom: 4 }}>
                {selectedListing.metadata.name}
              </h3>
              <span className="pill" style={{ 
                background: `${CATEGORY_COLORS[selectedListing.category]}20`,
                borderColor: CATEGORY_COLORS[selectedListing.category],
                color: CATEGORY_COLORS[selectedListing.category],
              }}>
                {CATEGORY_LABELS[selectedListing.category]}
              </span>
            </div>

            {/* Price Breakdown */}
            <div style={{ background: '#141416', borderRadius: 12, padding: 16, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#A1A1AA' }}>Price</span>
                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{selectedListing.price} STRK</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#A1A1AA' }}>Marketplace Fee (2.5%)</span>
                <span style={{ color: '#A1A1AA' }}>{(parseFloat(selectedListing.price) * 0.025).toFixed(4)} STRK</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#A1A1AA' }}>Creator Royalty (2.5%)</span>
                <span style={{ color: '#A1A1AA' }}>{(parseFloat(selectedListing.price) * 0.025).toFixed(4)} STRK</span>
              </div>
              <div style={{ height: 1, background: '#27272A', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>Total</span>
                <span style={{ color: '#3B82F6', fontWeight: 700, fontSize: 18 }}>
                  {(parseFloat(selectedListing.price) * 1.05).toFixed(4)} STRK
                </span>
              </div>
            </div>

            {/* Seller Info */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <span style={{ color: '#71717A', fontSize: 14 }}>Seller</span>
              <span style={{ color: '#E4E4E7', fontFamily: 'monospace', fontSize: 13 }}>
                {truncateAddress(selectedListing.seller_address)}
              </span>
            </div>

            {/* Status Messages */}
            {txSuccess && (
              <div style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid #22C55E', borderRadius: 12, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <span style={{ color: '#22C55E' }}>{txSuccess}</span>
              </div>
            )}
            {txError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid #EF4444', borderRadius: 12, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <span style={{ color: '#EF4444' }}>{txError}</span>
              </div>
            )}

            {/* Wallet Check */}
            {!walletAddress ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#F59E0B', marginBottom: 16, fontSize: 14 }}>
                  Connect your wallet to purchase this NFT
                </p>
                <button onClick={() => { setBuyModalOpen(false); navigate('/'); }} className="btn btn-primary" style={{ width: '100%' }}>
                  Connect Wallet
                </button>
              </div>
            ) : (
              <button
                onClick={handleBuy}
                disabled={txPending || !!txSuccess}
                className="btn btn-primary"
                style={{ width: '100%', opacity: txPending ? 0.6 : 1 }}
              >
                {txPending ? 'Processing...' : 'Confirm Purchase'}
              </button>
            )}
          </Modal>
        )}

        {/* List Modal */}
        {listModalOpen && selectedNft && (
          <Modal onClose={() => !txPending && setListModalOpen(false)}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                margin: '0 auto 16px',
                background: `linear-gradient(135deg, ${CATEGORY_COLORS[selectedNft.category]}40, ${CATEGORY_COLORS[selectedNft.category]}10)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <rect x="5" y="5" width="10" height="10" rx="3" fill={CATEGORY_COLORS[selectedNft.category]} opacity="0.6" />
                  <rect x="17" y="5" width="10" height="10" rx="3" fill={CATEGORY_COLORS[selectedNft.category]} opacity="0.6" />
                  <rect x="5" y="17" width="10" height="10" rx="3" fill={CATEGORY_COLORS[selectedNft.category]} opacity="0.6" />
                  <rect x="17" y="17" width="10" height="10" rx="3" fill={CATEGORY_COLORS[selectedNft.category]} />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#FFFFFF', marginBottom: 8 }}>
                List for Sale
              </h3>
              <p style={{ color: '#A1A1AA', fontSize: 14 }}>{selectedNft.metadata.name}</p>
            </div>

            {/* Price Input */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 14, color: '#E4E4E7', marginBottom: 8 }}>
                Price (STRK)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={listPrice}
                  onChange={(e) => setListPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  style={{
                    width: '100%',
                    padding: '14px 60px 14px 16px',
                    background: '#18181B',
                    border: '1px solid #27272A',
                    borderRadius: 12,
                    color: '#FFFFFF',
                    fontSize: 16,
                    outline: 'none',
                  }}
                />
                <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: '#71717A', fontSize: 14 }}>
                  STRK
                </span>
              </div>
              {listPrice && parseFloat(listPrice) > 0 && (
                <p style={{ color: '#71717A', fontSize: 12, marginTop: 8 }}>
                  You'll receive ~{(parseFloat(listPrice) * 0.95).toFixed(4)} STRK after fees
                </p>
              )}
            </div>

            {/* Status Messages */}
            {txSuccess && (
              <div style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid #22C55E', borderRadius: 12, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <span style={{ color: '#22C55E' }}>{txSuccess}</span>
              </div>
            )}
            {txError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid #EF4444', borderRadius: 12, padding: 12, marginBottom: 16, textAlign: 'center' }}>
                <span style={{ color: '#EF4444' }}>{txError}</span>
              </div>
            )}

            <button
              onClick={handleList}
              disabled={txPending || !listPrice || parseFloat(listPrice) <= 0 || !!txSuccess}
              className="btn btn-primary"
              style={{ width: '100%', opacity: (txPending || !listPrice || parseFloat(listPrice) <= 0) ? 0.6 : 1 }}
            >
              {txPending ? 'Listing...' : 'List NFT'}
            </button>
          </Modal>
        )}
      </div>
    </div>
  );
}

// ─── NFT Card Component ───
function NFTCard({
  category,
  name,
  price,
  owner,
  delay = 0,
  isOwned = false,
  isListed = false,
  actionLabel,
  onAction,
}: {
  category: NFTCategory;
  name: string;
  price?: string;
  owner: string;
  delay?: number;
  isOwned?: boolean;
  isListed?: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  const color = CATEGORY_COLORS[category];
  
  return (
    <div 
      className={`glass card-interactive animate-in delay-${delay + 1}`}
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Thumbnail placeholder */}
      <div style={{
        width: '100%',
        aspectRatio: '1',
        borderRadius: 12,
        background: `linear-gradient(135deg, ${color}30, ${color}08)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="6" y="6" width="12" height="12" rx="3" fill={color} opacity="0.5" />
          <rect x="22" y="6" width="12" height="12" rx="3" fill={color} opacity="0.5" />
          <rect x="6" y="22" width="12" height="12" rx="3" fill={color} opacity="0.5" />
          <rect x="22" y="22" width="12" height="12" rx="3" fill={color} />
        </svg>
        {/* Category badge */}
        <span className="pill" style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '4px 8px',
          fontSize: 10,
          background: `${color}20`,
          borderColor: color,
          color: color,
        }}>
          {CATEGORY_LABELS[category].split(' ')[0]}
        </span>
        {isListed && (
          <span className="pill" style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 8px',
            fontSize: 10,
            background: 'rgba(59, 130, 246, 0.2)',
            borderColor: '#3B82F6',
            color: '#3B82F6',
          }}>
            Listed
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </h4>
        <p style={{ fontSize: 11, color: '#71717A', fontFamily: 'monospace' }}>
          {truncateAddress(owner)}
        </p>
      </div>

      {/* Price & Action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {price ? (
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF' }}>{price}</span>
            <span style={{ fontSize: 11, color: '#71717A', marginLeft: 4 }}>STRK</span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: '#71717A' }}>Not listed</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: 'none',
            background: isOwned ? (isListed ? '#27272A' : '#3B82F6') : '#3B82F6',
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Activity Item Component ───
function ActivityItem({ activity, delay }: { activity: MarketplaceActivity; delay: number }) {
  const color = CATEGORY_COLORS[activity.category];
  const typeLabels = { sale: 'Sold', listing: 'Listed', delisting: 'Delisted' };
  const typeColors = { sale: '#22C55E', listing: '#3B82F6', delisting: '#71717A' };
  
  return (
    <div className={`glass animate-in delay-${delay + 1}`} style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 10,
        background: `linear-gradient(135deg, ${color}30, ${color}08)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="3" width="6" height="6" rx="2" fill={color} opacity="0.5" />
          <rect x="11" y="3" width="6" height="6" rx="2" fill={color} opacity="0.5" />
          <rect x="3" y="11" width="6" height="6" rx="2" fill={color} opacity="0.5" />
          <rect x="11" y="11" width="6" height="6" rx="2" fill={color} />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Token #{activity.token_id.slice(0, 8)}
          </span>
          <span style={{ fontSize: 11, color: typeColors[activity.type], fontWeight: 500 }}>
            {typeLabels[activity.type]}
          </span>
        </div>
        <p style={{ fontSize: 11, color: '#71717A' }}>
          {activity.from_address ? truncateAddress(activity.from_address) : ''} 
          {activity.to_address ? ` → ${truncateAddress(activity.to_address)}` : ''}
        </p>
      </div>
      {activity.price && (
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>{activity.price}</span>
          <span style={{ fontSize: 11, color: '#71717A', marginLeft: 4 }}>STRK</span>
        </div>
      )}
    </div>
  );
}

// ─── Empty State Component ───
function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: 'marketplace' | 'wallet' | 'collection' | 'activity';
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  const icons = {
    marketplace: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="8" width="14" height="14" rx="4" fill="#FFFFFF" opacity="0.4" />
        <rect x="26" y="8" width="14" height="14" rx="4" fill="#FFFFFF" opacity="0.4" />
        <rect x="8" y="26" width="14" height="14" rx="4" fill="#FFFFFF" opacity="0.4" />
        <rect x="26" y="26" width="14" height="14" rx="4" fill="#3B82F6" />
      </svg>
    ),
    wallet: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="12" width="36" height="26" rx="4" stroke="#FFFFFF" strokeWidth="2" opacity="0.4" />
        <circle cx="34" cy="25" r="3" fill="#3B82F6" />
      </svg>
    ),
    collection: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="10" y="6" width="28" height="36" rx="4" stroke="#FFFFFF" strokeWidth="2" opacity="0.4" />
        <path d="M18 18h12M18 26h8" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    activity: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M8 24h8l4-12 8 24 4-12h8" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  };

  return (
    <div className="glass animate-in delay-2" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, margin: '0 auto 24px', borderRadius: 20, background: '#27272A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icons[icon]}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: '#FFFFFF', marginBottom: 8 }}>{title}</h3>
      <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.5, marginBottom: action ? 24 : 0 }}>{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn btn-primary" style={{ minWidth: 160 }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// ─── Modal Component ───
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 200,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass animate-in"
        style={{
          width: '100%',
          maxWidth: 400,
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 32,
            height: 32,
            borderRadius: 8,
            border: 'none',
            background: '#27272A',
            color: '#A1A1AA',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
          </svg>
        </button>
        {children}
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
  const nodesOnline = relayerAPI.availableModels.length;
  
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Header */}
          <div className="animate-in">
            <p style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              letterSpacing: '0.08em', 
              textTransform: 'uppercase', 
              color: '#71717A', 
              marginBottom: 4,
              margin: 0
            }}>COMPUTE</p>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#E4E4E7', margin: 0 }}>Private Compute</h2>
          </div>

          {/* AI Tasks Card */}
          <div className="glass animate-in delay-1" style={{ padding: 20, borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: 12, 
                  background: '#27272A', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <IconCompute active={false} />
                </div>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#E4E4E7', margin: 0 }}>AI Tasks</p>
                  <p style={{ fontSize: 13, color: '#71717A', margin: 0 }}>Run inference on GPU nodes</p>
                </div>
              </div>
              <span className="pill" style={{ 
                background: nodesOnline > 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: nodesOnline > 0 ? '#22C55E' : '#EF4444',
                border: 'none',
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600
              }}>
                {nodesOnline > 0 ? 'Ready' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1, textAlign: 'center', padding: 12, background: '#18181B', borderRadius: 10 }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#E4E4E7', margin: 0 }}>{nodesOnline}</p>
                <p style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Nodes</p>
              </div>
              <div style={{ flex: 1, textAlign: 'center', padding: 12, background: '#18181B', borderRadius: 10 }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: '#E4E4E7', margin: 0 }}>0</p>
                <p style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Tasks</p>
              </div>
            </div>
          </div>

          {/* No Compute Nodes Card (conditional) */}
          {nodesOnline === 0 && (
            <div className="glass animate-in delay-2" style={{ padding: 24, borderRadius: 16, textAlign: 'center' }}>
              <div style={{ 
                width: 56, 
                height: 56, 
                borderRadius: 16, 
                background: '#27272A', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#E4E4E7', marginBottom: 8 }}>No compute nodes online</p>
              <p style={{ fontSize: 14, color: '#71717A', margin: 0 }}>GPU providers will appear here when they connect to the network.</p>
            </div>
          )}

          {/* Balance Card */}
          <div className="glass animate-in delay-2" style={{ padding: 20, borderRadius: 16 }}>
            <p style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              letterSpacing: '0.08em', 
              textTransform: 'uppercase', 
              color: '#71717A', 
              margin: 0,
              marginBottom: 16
            }}>Wallet Balance</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#E4E4E7' }}>{connectedWallet.balance_strk || '0'}</span>
              <span style={{ fontSize: 18, color: '#71717A' }}>STRK</span>
            </div>
            <div style={{ paddingTop: 16, borderTop: '1px solid #27272A' }}>
              <p style={{ fontSize: 13, color: '#71717A', fontFamily: 'monospace', wordBreak: 'break-all', margin: 0 }}>
                {connectedWallet.address}
              </p>
            </div>
          </div>

          {/* Network Status Card */}
          <div className="glass animate-in delay-3" style={{ padding: 20, borderRadius: 16 }}>
            <p style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              letterSpacing: '0.08em', 
              textTransform: 'uppercase', 
              color: '#71717A', 
              margin: 0,
              marginBottom: 16
            }}>Network Status</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, color: '#A1A1AA' }}>Relayer</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: relayerAPI.isConnected ? '#22C55E' : '#EF4444' }}>
                    {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                  </span>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    backgroundColor: relayerAPI.isConnected ? '#22C55E' : '#EF4444',
                    boxShadow: relayerAPI.isConnected ? '0 0 8px #22C55E' : 'none'
                  }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, color: '#A1A1AA' }}>Compute Nodes</span>
                <span style={{ fontSize: 14, color: '#E4E4E7', fontWeight: 500 }}>{nodesOnline}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, color: '#A1A1AA' }}>Chain</span>
                <span className="pill">Starknet L2</span>
              </div>
            </div>
          </div>

          {/* Private Compute Section */}
          <div className="glass animate-in delay-4" style={{ padding: 20, borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ 
                width: 44, 
                height: 44, 
                borderRadius: 12, 
                background: 'rgba(99, 102, 241, 0.15)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#E4E4E7', margin: 0, marginBottom: 4 }}>Private Compute</p>
                <p style={{ fontSize: 13, color: '#71717A', margin: 0 }}>Your inference runs on decentralized GPU nodes. Only you see the results.</p>
              </div>
            </div>
          </div>

          {/* Disconnect Button */}
          <button 
            onClick={onDisconnect}
            className="animate-in delay-5"
            style={{ 
              width: '100%', 
              padding: '14px 20px',
              background: 'transparent',
              border: '1px solid #27272A',
              borderRadius: 12,
              color: '#EF4444',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
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
    { id: 'nft', label: 'NFT', path: '/nft', Icon: IconNFT },
    { id: 'dashboard', label: 'Stats', path: '/dashboard', Icon: IconStats },
  ];

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'rgba(9, 9, 11, 0.95)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid #27272A',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      zIndex: 100
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        maxWidth: 448,
        margin: '0 auto',
        padding: '8px 16px 8px 16px'
      }}>
        {tabs.map(({ id, label, path, Icon }) => {
          const isActive = currentView === id;
          return (
            <button
              key={id}
              onClick={() => navigate(path)}
              style={{ 
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '8px 4px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'transform 0.15s ease',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon active={isActive} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: isActive ? '#3B82F6' : '#71717A' }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
