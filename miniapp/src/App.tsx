import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, NavigateFunction } from 'react-router-dom';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { PaymentFlow } from './components/PaymentFlow';
import { OneTapApprove } from './components/OneTapApprove';
import { DebugOverlay, addDebugBootStep } from './components/DebugOverlay';
import { AnimatedLogo } from './components/AnimatedLogo';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import { useTelegramData } from './hooks/useTelegramData';
import { useWalletBalance } from './hooks/useWalletBalance';
import { ComputeTier } from './lib/starknet';
import { loadPaymentContext } from '@/lib/paymentContext';
import type { ConnectedWallet, InferenceRequest } from './types';

// Map bot tier names (small/medium/large) to MiniApp ComputeTier (BASIC/PRO/PREMIUM)
function mapBotTierToComputeTier(botTier: string): ComputeTier {
  const tierMap: Record<string, ComputeTier> = {
    small: 'BASIC',
    medium: 'PRO',
    large: 'PREMIUM',
    // Also handle direct tier names in case they're sent
    basic: 'BASIC',
    pro: 'PRO',
    premium: 'PREMIUM',
  };
  return tierMap[botTier.toLowerCase()] || 'BASIC';
}

const WALLET_STORAGE_KEY = 'smainer_connected_wallet';

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

/* ═══════════════════════════════════════════════════════════════════════════
   WALLET REDIRECT PAGE
   Wave 2: Auto-redirects to wallet deep link. Shows minimal loading state.
   Falls back to a tappable <a> after 3s for iOS universal link requirement
   (programmatic navigation does NOT trigger universal links on iOS).
   ═══════════════════════════════════════════════════════════════════════════ */

function WalletRedirectPage({ wallet, deepLink }: { wallet: string; deepLink: string }) {
  const [showFallback, setShowFallback] = React.useState(false);

  React.useEffect(() => {
    // Attempt programmatic redirect (works on Android, some desktop browsers)
    window.location.href = deepLink;

    // If we're still here after 3s, iOS blocked the redirect — show tap fallback
    const timer = setTimeout(() => setShowFallback(true), 3000);
    return () => clearTimeout(timer);
  }, [deepLink]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: '#0A0A0F',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {!showFallback ? (
        <>
          {/* Spinner while auto-redirect fires */}
          <div style={{ marginBottom: '16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
          <p style={{ fontSize: '14px', color: '#A1A1AA' }}>
            Redirecting to wallet...
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </>
      ) : (
        <>
          {/* Fallback: tappable link for iOS universal link requirement */}
          <p style={{
            fontSize: '14px', color: '#A1A1AA', textAlign: 'center',
            margin: '0 0 20px 0', maxWidth: '280px', lineHeight: '1.5',
          }}>
            Tap to open your wallet
          </p>
          <a
            href={deepLink}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              maxWidth: '320px',
              padding: '16px 24px',
              borderRadius: '14px',
              background: wallet === 'braavos'
                ? 'linear-gradient(135deg, #F5841F, #FFB84D)'
                : 'linear-gradient(135deg, #FF875B, #FF6B4A)',
              color: wallet === 'braavos' ? '#000' : '#fff',
              fontSize: '17px',
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(245, 132, 31, 0.4)',
            }}
          >
            Open Wallet
          </a>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENT FLOW WRAPPER (for bot-initiated payment)
   ═══════════════════════════════════════════════════════════════════════════ */

interface PaymentFlowParams {
  prompt: string;
  tier: ComputeTier;
  chatId: string;
  messageId: string;
  nonce?: string;
}

function PaymentFlowWrapper({ params }: { params: PaymentFlowParams }) {
  const handleSuccess = (taskId: string) => {
    // sendData() in PaymentFlow already closes the MiniApp and sends data to bot
    // This callback is for any additional cleanup if needed
    console.log('Payment flow completed, task:', taskId);
  };

  const handleCancel = () => {
    // Close the MiniApp when user cancels
    try {
      (window.Telegram?.WebApp as any)?.close?.();
    } catch (e) {
      // Fallback: navigate back or show message
      console.log('Could not close WebApp:', e);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#09090B',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      {/* Brand header */}
      <div style={{ 
        position: 'absolute', 
        top: '20px', 
        left: '50%', 
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <AnimatedLogo size={28} />
        <span style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF' }}>SMAINER</span>
      </div>

      {/* PaymentFlow handles the rest */}
      <PaymentFlow
        prompt={params.prompt}
        tier={params.tier}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
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
      <Route path="/approve/:chatId/:credential" element={<OneTapApprove />} />
      <Route path="/approve/:chatId" element={<OneTapApprove />} />
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
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
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
        <div className="animate-in delay-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left', borderRadius: 16, width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#27272A' }}>
                <IconStats />
              </div>
              <div>
                <h4 style={{ fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>Dashboard</h4>
                <p style={{ fontSize: 12, color: '#71717A', margin: 0 }}>Balance & status</p>
              </div>
            </div>
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
   DASHBOARD VIEW — Compute Status & GPU Nodes
   ═══════════════════════════════════════════════════════════════════════════ */

function DashboardView({
  connectedWallet,
  relayerAPI,
  onDisconnect,
  isInTelegram,
}: {
  connectedWallet: ConnectedWallet
  relayerAPI: any
  onDisconnect: () => void
  isInTelegram: boolean
}) {
  const nodes = relayerAPI.availableModels || [];
  const nodesOnline = nodes.length;
  
  return (
    <div style={{ 
      flex: 1, 
      overflowY: 'auto', 
      background: 'var(--void)',
    }}>
      {/* Content container with proper padding */}
      <div style={{ 
        padding: '24px 20px 120px 20px',
        maxWidth: 480,
        margin: '0 auto',
      }}>
        {/* ─── Header Section ─── */}
        <div className="animate-in" style={{ marginBottom: 24 }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.1em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 6
          }}>DASHBOARD</p>
          <h2 style={{ 
            fontSize: 26, 
            fontWeight: 700, 
            color: 'var(--text-primary)', 
            margin: 0,
            letterSpacing: '-0.02em'
          }}>Private Compute</h2>
        </div>

        {/* ─── Status Cards Row ─── */}
        <div className="animate-in delay-1" style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 12,
          marginBottom: 20
        }}>
          <div className="glass" style={{ 
            padding: 20, 
            borderRadius: 16,
            textAlign: 'center'
          }}>
            <p style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              color: nodesOnline > 0 ? 'var(--success)' : 'var(--text-muted)', 
              margin: 0,
              marginBottom: 4
            }}>{nodesOnline}</p>
            <p style={{ 
              fontSize: 12, 
              fontWeight: 600,
              color: 'var(--text-hint)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.08em', 
              margin: 0 
            }}>Nodes Online</p>
          </div>
          <div className="glass" style={{ 
            padding: 20, 
            borderRadius: 16,
            textAlign: 'center'
          }}>
            <p style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              color: 'var(--text-secondary)', 
              margin: 0,
              marginBottom: 4
            }}>0</p>
            <p style={{ 
              fontSize: 12, 
              fontWeight: 600,
              color: 'var(--text-hint)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.08em', 
              margin: 0 
            }}>Tasks Run</p>
          </div>
        </div>

        {/* ─── GPU Nodes Section ─── */}
        <div className="animate-in delay-2" style={{ marginBottom: 20 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 14
          }}>
            <h3 style={{ 
              fontSize: 15, 
              fontWeight: 600, 
              color: 'var(--text-secondary)', 
              margin: 0 
            }}>GPU Nodes</h3>
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              color: nodesOnline > 0 ? 'var(--success)' : 'var(--text-hint)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: nodesOnline > 0 ? 'var(--success)' : 'var(--text-hint)',
                boxShadow: nodesOnline > 0 ? '0 0 8px var(--success)' : 'none'
              }} />
              {nodesOnline > 0 ? `${nodesOnline} available` : 'None available'}
            </span>
          </div>
          
          {/* GPU Node Cards */}
          {nodesOnline > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {nodes.map((node: any, index: number) => (
                <div 
                  key={node.node_id || index} 
                  className="glass"
                  style={{ 
                    padding: 16,
                    borderRadius: 16,
                    borderLeft: '3px solid var(--success)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* GPU Icon + Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(34, 197, 94, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                            <rect x="9" y="9" width="6" height="6" />
                            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                          </svg>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ 
                            fontSize: 15, 
                            fontWeight: 600, 
                            color: 'var(--text-primary)', 
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {node.gpu || 'GPU Node'}
                          </p>
                          <p style={{ 
                            fontSize: 12, 
                            color: 'var(--text-hint)', 
                            margin: 0,
                            fontFamily: 'monospace'
                          }}>
                            {node.node_id?.slice(0, 8) || '...'}
                          </p>
                        </div>
                      </div>
                      {/* Specs */}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div>
                          <p style={{ fontSize: 11, color: 'var(--text-hint)', margin: 0, marginBottom: 2 }}>RAM</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>{node.ram_gb || '?'} GB</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, color: 'var(--text-hint)', margin: 0, marginBottom: 2 }}>Tiers</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
                            {node.supported_tiers?.join(', ') || 'small'}
                          </p>
                        </div>
                      </div>
                    </div>
                    {/* Status Badge */}
                    <span style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(34, 197, 94, 0.12)',
                      color: 'var(--success)',
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0
                    }}>
                      Ready
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="glass" style={{ 
              padding: 32, 
              borderRadius: 16, 
              textAlign: 'center' 
            }}>
              <div style={{ 
                width: 56, 
                height: 56, 
                borderRadius: 14, 
                background: 'var(--surface-glass)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-hint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6v6H9z" />
                  <path d="M4 9h1M4 15h1M19 9h1M19 15h1M9 4v1M15 4v1M9 19v1M15 19v1" />
                </svg>
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                No GPU nodes online
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-hint)', margin: 0, lineHeight: 1.5 }}>
                GPU providers will appear here when they connect to the network.
              </p>
            </div>
          )}
        </div>

        {/* ─── Wallet Balance Card ─── */}
        <div className="glass animate-in delay-3" style={{ 
          padding: 20, 
          borderRadius: 16,
          marginBottom: 16
        }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.08em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 14
          }}>Wallet Balance</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)' }}>
              {connectedWallet.balance_strk || '0'}
            </span>
            <span style={{ fontSize: 16, color: 'var(--text-hint)', fontWeight: 500 }}>STRK</span>
          </div>
          <div style={{ 
            paddingTop: 14, 
            borderTop: '1px solid var(--border-subtle)' 
          }}>
            <p style={{ 
              fontSize: 12, 
              color: 'var(--text-hint)', 
              fontFamily: 'monospace', 
              wordBreak: 'break-all', 
              margin: 0,
              lineHeight: 1.4
            }}>
              {connectedWallet.address}
            </p>
          </div>
        </div>

        {/* ─── Network Status Card ─── */}
        <div className="glass animate-in delay-4" style={{ 
          padding: 20, 
          borderRadius: 16,
          marginBottom: 16
        }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.08em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 16
          }}>Network Status</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Relayer</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ 
                  fontSize: 14, 
                  fontWeight: 500, 
                  color: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)' 
                }}>
                  {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                </span>
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  backgroundColor: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)',
                  boxShadow: relayerAPI.isConnected ? '0 0 8px var(--success)' : 'none'
                }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Compute Nodes</span>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>{nodesOnline}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Chain</span>
              <span className="pill">Starknet L2</span>
            </div>
          </div>
        </div>

        {/* ─── Privacy Info Card ─── */}
        <div className="glass animate-in delay-5" style={{ 
          padding: 18, 
          borderRadius: 16,
          marginBottom: 20,
          background: 'rgba(99, 102, 241, 0.06)',
          borderColor: 'rgba(99, 102, 241, 0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ 
              width: 42, 
              height: 42, 
              borderRadius: 12, 
              background: 'rgba(99, 102, 241, 0.15)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, marginBottom: 4 }}>
                Private Compute
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                Your inference runs on decentralized GPU nodes. Only you see the results.
              </p>
            </div>
          </div>
        </div>

        {/* ─── Disconnect / Unlink Button ─── */}
        <button
          onClick={onDisconnect}
          className="animate-in delay-6"
          style={{
            width: '100%',
            padding: '14px 20px',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            color: 'var(--error)',
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {isInTelegram ? 'Disconnect & Unlink Wallet' : 'Disconnect Wallet'}
        </button>
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
