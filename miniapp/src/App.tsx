import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { PaymentFlowWrapper } from './components/PaymentFlowWrapper';
import { OneTapApprove } from './components/OneTapApprove';
import { WalletRedirectPage } from './components/WalletRedirectPage';
import { AnimatedLogo } from './components/AnimatedLogo';
import { DebugOverlay, addDebugBootStep } from './components/DebugOverlay';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import { useTelegramData } from './hooks/useTelegramData';
import { useWalletBalance } from './hooks/useWalletBalance';
import { loadPaymentContext } from '@/lib/paymentContext';
import type { ConnectedWallet, InferenceRequest } from './types';
import { mapBotTierToComputeTier, loadPersistedWallet, persistWallet, clearPersistedWallet, WALLET_STORAGE_KEY } from './utils';
import { HomeView } from './views/HomeView';
import { DashboardView } from './views/DashboardView';
import { NavBar } from './components/navigation/NavBar';



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
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'white', marginBottom: '8px' }}>Wallet Flow Unavailable</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Reopen the MiniApp from Telegram and retry the payment flow.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}





export default function App() {
  // Check for payment flow URL params (from bot "Pay & Compute" button)
  const searchParams = new URLSearchParams(window.location.search);
  const action = searchParams.get('action');

  if (action === 'wallet-redirect') {
    const wallet = searchParams.get('wallet') || 'braavos';

    let walletDeepLink: string;
    if (wallet === 'braavos') {
      // Use clean path — payment context is in localStorage (storePaymentContext).
      // No query params to avoid the ?-encoding issue with link.braavos.app.
      walletDeepLink = `https://link.braavos.app/dapp/smainer-miniapp.vercel.app/pay-resume`;
    } else {
      // Argent fallback — open pay-resume directly in browser
      walletDeepLink = `https://smainer-miniapp.vercel.app/pay-resume`;
    }

    return <WalletRedirectPage wallet={wallet} deepLink={walletDeepLink} />;
  }

  if (action === 'pay') {
    const prompt = searchParams.get('prompt') || '';
    const tierParam = searchParams.get('tier') || 'small';
    const chatId = searchParams.get('chat_id') || '';
    const messageId = searchParams.get('message_id') || '';
    const nonce = searchParams.get('nonce') || '';

    // Validate required params
    if (!prompt) {
      console.error('Payment flow missing prompt parameter');
    }

    const tier = mapBotTierToComputeTier(tierParam);

    return (
      <PaymentFlowWrapper 
        params={{ prompt, tier, chatId, messageId, nonce }} 
      />
    );
  }

  // Resume payment after wallet-app redirect (Braavos / Argent).
  // The wallet's in-app browser opens /pay-resume — we read payment params
  // from localStorage (stored before the redirect) and render PaymentFlow.
  if (window.location.pathname === '/pay-resume') {
    const pending = loadPaymentContext();
    if (pending) {
      const tier = mapBotTierToComputeTier(pending.tier);

      // Inject stored params into URL so PaymentFlow can read them via searchParams
      const resumeParams = new URLSearchParams({
        action: 'pay',
        prompt: pending.prompt,
        tier: pending.tier,
        chat_id: pending.chatId,
        message_id: pending.messageId,
        ...(pending.nonce ? { nonce: pending.nonce } : {}),
      });
      window.history.replaceState(null, '', `/?${resumeParams.toString()}`);

      return (
        <PaymentFlowWrapper
          params={{
            prompt: pending.prompt,
            tier,
            chatId: pending.chatId,
            messageId: pending.messageId,
            nonce: pending.nonce,
          }}
        />
      );
    }
    // No stored context or expired — fall through to normal app
  }

  // Normal app routing
  return (
    <Routes>
      <Route path="/" element={<MainApp />} />
      <Route path="/home" element={<MainApp />} />
      <Route path="/chat" element={<MainApp />} />
      <Route path="/approve" element={<OneTapApprove />} />
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
  const currentView = pathView as 'home' | 'chat' | 'dashboard';

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

  // Fetch STRK balance from chain — pass wallet address so bot-linked wallets also get a live balance
  const { balance: fetchedBalance, refetch: refetchBalance } = useWalletBalance(connectedWallet?.address);

  // Sync fetched balance to connectedWallet state
  useEffect(() => {
    if (connectedWallet && fetchedBalance && fetchedBalance !== '0' && fetchedBalance !== connectedWallet.balance_strk) {
      setConnectedWallet(prev => prev ? { ...prev, balance_strk: fetchedBalance } : null);
    }
  }, [connectedWallet, fetchedBalance]);

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
      persistWallet(connectedWallet);
    } else {
      clearPersistedWallet();
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
    persistWallet(wallet);

    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({ action: 'wallet_connect', address: wallet.address, wallet_type: wallet.type });
      channel.close();
    } catch { /* ignore */ }

    navigate('/chat', { replace: true });
  };

  const handleWalletDisconnect = async () => {
    // If in Telegram, also unlink from the bot's KV store
    if (isInTelegram && initDataRaw) {
      try {
        await fetch(`${botApiUrl}/api/wallet-unlink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initDataRaw }),
        });
      } catch (e) {
        console.warn('[App] wallet-unlink request failed (continuing with local disconnect):', e);
      }
    }

    // Clear local wallet state and localStorage
    clearPersistedWallet();
    setConnectedWallet(null);
    navigate('/', { replace: true });
    try {
      const channel = new BroadcastChannel('smainer-wallet');
      channel.postMessage({ action: 'wallet_disconnect' });
      channel.close();
    } catch { /* ignore */ }
  };

  const handleSubmitInferenceTask = async (
    request: InferenceRequest, 
    onChainTaskId?: string
  ): Promise<string> => {
    const taskId = await relayerAPI.submitInferenceTask(request, onChainTaskId);
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
            {isInTelegram ? (
              <div className="glass" style={{ padding: 24, borderRadius: 16, textAlign: 'center' }}>
                <h2 style={{ fontSize: 22, fontWeight: 600, color: '#FFFFFF', marginBottom: 8 }}>Start From The Chat</h2>
                <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.6, marginBottom: 16 }}>
                  Wallet connection in production now happens only inside the Pay &amp; Compute flow. Send a prompt in the bot chat and approve the payment there.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      miniApp?.close();
                    } catch {
                      navigate('/home', { replace: true });
                    }
                  }}
                  className="btn btn-primary"
                >
                  Return To Telegram Chat
                </button>
              </div>
            ) : (
              <WalletSectionBoundary>
                <WalletConnect 
                  onConnect={handleWalletConnect}
                  onDisconnect={handleWalletDisconnect}
                />
              </WalletSectionBoundary>
            )}
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
        {currentView === 'dashboard' && <DashboardView connectedWallet={connectedWallet} relayerAPI={relayerAPI} onDisconnect={handleWalletDisconnect} isInTelegram={isInTelegram} />}
      </div>
      
      {/* Navigation */}
      <NavBar currentView={currentView} navigate={navigate} />
    </main>
  );
}
