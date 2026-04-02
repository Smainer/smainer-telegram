import { useState, useEffect, useMemo } from 'react';
import { useAccount, useConnect } from '@starknet-react/core';
import { useSmainerContract } from '@/hooks/useSmainerContract';
import { useCostEstimate } from '@/hooks/useCostEstimate';
import { usePayment } from '@/hooks/usePayment';
import { ComputeTier, COMPUTE_TIERS } from '@/lib/starknet';
import { useTelegramData } from '@/hooks/useTelegramData';
import { storePaymentContext, clearPaymentContext } from '@/lib/paymentContext';

// Version for deployment verification (increment on each deploy)
const BUILD_VERSION = '2026-04-02-v16';

// LocalStorage key for persisted wallet session (TM-005)
const WALLET_PERSIST_KEY = 'smainer_connected_wallet';

// Approved redirect origins — excludes bot domain to prevent self-referential attacks
const ALLOWED_REDIRECT_ORIGINS = [
  'https://smainer-miniapp.vercel.app',
  'https://app.smainer.io',
] as const;

function isAllowedRedirectOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_ORIGINS.some(
      (origin) => parsed.origin === origin || parsed.hostname.endsWith('.smainer.io'),
    );
  } catch {
    return false;
  }
}

// Detect injected wallet directly (bypasses starknet-react race condition)
function hasInjectedWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).starknet_braavos || !!(window as any).starknet_argentX;
}

// Detect mobile vs desktop
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// ---------------------------------------------------------------------------
// TM-005: Persistent wallet session helpers
// ---------------------------------------------------------------------------

/** Persist the connected wallet address to localStorage for returning users. */
function persistWallet(address: string): void {
  try {
    if (!address || !/^0x[0-9a-fA-F]{1,64}$/.test(address)) return;
    // Store in ConnectedWallet-compatible format (shared with App.tsx)
    window.localStorage.setItem(
      WALLET_PERSIST_KEY,
      JSON.stringify({
        address,
        type: 'manual',
        balance_strk: '0',
        balance_smainer: '0',
      }),
    );
  } catch {
    // localStorage unavailable — best-effort
  }
}

/** Load persisted wallet address. Returns null when missing or invalid.
 *  Compatible with both App.tsx ConnectedWallet format and legacy format.
 */
function loadPersistedWalletAddress(): string | null {
  try {
    const raw = window.localStorage.getItem(WALLET_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const address = parsed.address;
    if (!address || !/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
      window.localStorage.removeItem(WALLET_PERSIST_KEY);
      return null;
    }
    return address;
  } catch {
    window.localStorage.removeItem(WALLET_PERSIST_KEY);
    return null;
  }
}

/** Clear persisted wallet (on disconnect). */
function clearPersistedWallet(): void {
  try { window.localStorage.removeItem(WALLET_PERSIST_KEY); } catch { /* ignore */ }
}

// Shared wallet deep link buttons — used in both connect step (no connectors) and
// confirm step (when capabilities.requiresRedirect is true).
function WalletPayButtons() {
  const fireHaptic = () => {
    try {
      (window.Telegram?.WebApp as any)?.HapticFeedback?.notificationOccurred('success');
    } catch {
      // HapticFeedback not available — ignore
    }
  };

  const openLink = (url: string) => {
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
      // Close the MiniApp after a short delay so user isn't left staring
      // at a stale "Pay with Braavos" screen when they return to Telegram.
      setTimeout(() => {
        try {
          (window.Telegram?.WebApp as any)?.close?.();
        } catch {
          // close() not available — ignore
        }
      }, 1500);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleBraavos = () => {
    fireHaptic();
    // Persist payment context before leaving Telegram — wallet redirect
    // chain may lose URL query params.
    const sp = new URLSearchParams(window.location.search);
    storePaymentContext({
      prompt: sp.get('prompt') || '',
      tier: sp.get('tier') || 'small',
      chatId: sp.get('chat_id') || '',
      messageId: sp.get('message_id') || '',
      model: sp.get('model') || undefined,
      nonce: sp.get('nonce') || undefined,
      initDataRaw: (window as any).Telegram?.WebApp?.initData || undefined,
    });
    if (isMobileDevice()) {
      // Mobile: intermediate redirect page — user taps <a> to trigger universal link → Braavos app
      const redirectParams = new URLSearchParams(window.location.search);
      redirectParams.set('action', 'wallet-redirect');
      redirectParams.set('wallet', 'braavos');
      const redirectUrl = `${window.location.origin}/?${redirectParams.toString()}`;
      // Validate redirect URL against allowlist
      if (!isAllowedRedirectOrigin(redirectUrl)) {
        console.error('[PaymentFlow] Redirect URL blocked by allowlist:', redirectUrl);
        return;
      }
      openLink(redirectUrl);
    } else {
      // Desktop: open pay URL directly in browser — wallet extension works there
      const payUrl = `https://smainer-miniapp.vercel.app${window.location.pathname}${window.location.search}`;
      if (!isAllowedRedirectOrigin(payUrl)) {
        console.error('[PaymentFlow] Pay URL blocked by allowlist:', payUrl);
        return;
      }
      openLink(payUrl);
    }
  };

  const handleArgent = () => {
    fireHaptic();
    // Persist payment context before leaving Telegram
    const sp = new URLSearchParams(window.location.search);
    storePaymentContext({
      prompt: sp.get('prompt') || '',
      tier: sp.get('tier') || 'small',
      chatId: sp.get('chat_id') || '',
      messageId: sp.get('message_id') || '',
      model: sp.get('model') || undefined,
      nonce: sp.get('nonce') || undefined,
      initDataRaw: (window as any).Telegram?.WebApp?.initData || undefined,
    });
    // Argent has no in-app dApp browser — always open in browser (extension works on desktop)
    const payUrl = `https://smainer-miniapp.vercel.app${window.location.pathname}${window.location.search}`;
    if (!isAllowedRedirectOrigin(payUrl)) {
      console.error('[PaymentFlow] Pay URL blocked by allowlist:', payUrl);
      return;
    }
    openLink(payUrl);
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
      className="flex flex-col gap-3"
    >
      {/* Braavos — primary, orange gradient */}
      <button
        onClick={handleBraavos}
        style={{
          width: '100%',
          padding: '14px 20px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #F5841F, #FFB84D)',
          color: '#000',
          border: 'none',
          fontSize: '16px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
        }}
        className="w-full px-5 py-3.5 rounded-xl font-semibold text-black flex items-center justify-center gap-2.5 bg-gradient-to-r from-[#F5841F] to-[#FFB84D] hover:from-[#E07419] hover:to-[#F0A83D] transition-all duration-200 active:scale-[0.98] shadow-lg"
      >
        {WALLET_BRANDS.braavos.icon}
        Pay with Braavos
      </button>

      {/* Argent — secondary, subtler styling */}
      <button
        onClick={handleArgent}
        style={{
          width: '100%',
          padding: '12px 20px',
          borderRadius: '12px',
          background: 'rgba(255,135,91,0.15)',
          color: '#FF875B',
          border: '1px solid rgba(255,135,91,0.3)',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
        }}
        className="w-full px-5 py-3 rounded-xl font-medium text-[#FF875B] flex items-center justify-center gap-2.5 bg-[#FF875B]/15 border border-[#FF875B]/30 hover:bg-[#FF875B]/25 transition-all duration-200 active:scale-[0.98] text-sm"
      >
        {WALLET_BRANDS.argent.icon}
        Pay with Argent (Browser)
      </button>

      {/* Helper text */}
      <p
        style={{ color: '#71717A', fontSize: '12px', textAlign: 'center', margin: '0' }}
        className="text-zinc-500 text-xs text-center m-0"
      >
        Opens Smainer in your wallet app to sign
      </p>
    </div>
  );
}

// Kept for backwards-compat call-site in connect step (no connectors available)
function WalletDeepLinks() {
  return <WalletPayButtons />;
}

interface PaymentFlowProps {
  prompt: string;
  tier?: ComputeTier;
  onSuccess: (taskId: string) => void;
  onCancel: () => void;
}

type PaymentStep = 'connect' | 'confirm' | 'processing' | 'success' | 'error';

// Debug info interface
interface DebugInfo {
  rawBalance: string | null;
  balanceError: string | null;
  contractReady: boolean;
  address: string | null;
}

// Wallet brand colors and icons
const WALLET_BRANDS = {
  braavos: {
    bg: 'bg-gradient-to-r from-[#F5841F] to-[#FFB84D]',
    hoverBg: 'hover:from-[#E07419] hover:to-[#F0A83D]',
    text: 'text-black',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" fill="currentColor" opacity="0.3"/>
        <path d="M12 2L4 7l8 5 8-5-8-5z" fill="currentColor"/>
        <path d="M4 17l8 5 8-5M4 12l8 5 8-5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      </svg>
    ),
  },
  argent: {
    bg: 'bg-gradient-to-r from-[#FF875B] to-[#FF6B4A]',
    hoverBg: 'hover:from-[#FF7849] hover:to-[#FF5B39]',
    text: 'text-white',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2"/>
        <path d="M12 6l-6 6 6 6 6-6-6-6z" fill="currentColor"/>
      </svg>
    ),
  },
} as const;

// Smainer logo header
function SmainerLogo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--blue)] to-[#60A5FA] flex items-center justify-center shadow-lg shadow-blue-500/20">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" fill="white"/>
        </svg>
      </div>
      <span className="text-lg font-bold text-white tracking-tight">SMAINER</span>
    </div>
  );
}

// Format wallet address
function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Spinner component
function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

export function PaymentFlow({
  prompt,
  tier = 'BASIC',
  onSuccess,
  onCancel
}: PaymentFlowProps) {
  const [balance, setBalance] = useState<string>('0');
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    rawBalance: null,
    balanceError: null,
    contractReady: false,
    address: null,
  });
  const [botLinkedWallet, setBotLinkedWallet] = useState<string | null>(null);
  const [injectedWalletTimedOut, setInjectedWalletTimedOut] = useState(false);

  // TM-005: Check for persisted wallet from localStorage on mount
  const persistedWallet = useMemo(() => loadPersistedWalletAddress(), []);

  // TM-008: Bot signals wallet_linked=1 when user has linked wallet
  const walletLinkedHint = useMemo(
    () => new URLSearchParams(window.location.search).get('wallet_linked') === '1',
    [],
  );

  // Telegram data
  const { initDataRaw, isInTelegram } = useTelegramData();
  const botApiUrl = (import.meta.env as Record<string, string>).VITE_BOT_API_URL || 'https://bot.smainer.io';

  // Read URL parameters for Telegram integration
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id');
  const messageId = searchParams.get('message_id');
  const userModel = searchParams.get('model') || 'llama3.1:8b';
  const paymentNonce = searchParams.get('nonce') || '';

  // Wallet connection hooks
  const { address, account, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Prioritize MiniApp-connected wallet; fall back to bot-linked or persisted wallet
  const effectiveAddress = useMemo(
    () => address || botLinkedWallet || persistedWallet,
    [address, botLinkedWallet, persistedWallet],
  );

  // Debug: Log connected address
  useEffect(() => {
    if (address) {
      console.log('[PaymentFlow] Connected wallet address:', address);
    }
  }, [address]);

  // Filter to only available connectors
  const availableConnectors = useMemo(() => {
    try {
      return connectors.filter(c => {
        try {
          return c.available();
        } catch {
          return false;
        }
      });
    } catch (e) {
      console.error('Failed to check connectors:', e);
      return [];
    }
  }, [connectors]);

  const {
    checkBalance,
    isContractReady,
  } = useSmainerContract();

  // Payment strategy hook — wired up with bot-linked wallet for environment resolution
  const {
    phase,
    taskId,
    errorMessage,
    isLoading,
    capabilities,
    pay,
    reset: resetPayment,
  } = usePayment(botLinkedWallet);

  // Fetch bot-linked wallet on mount
  useEffect(() => {
    if (!isInTelegram || !initDataRaw) {
      return;
    }

    (async () => {
      try {
        console.log('[PaymentFlow] Checking bot-linked wallet...');
        const response = await fetch(
          `${botApiUrl}/api/wallet-check?initData=${encodeURIComponent(initDataRaw)}`
        );

        if (!response.ok) {
          console.warn('[PaymentFlow] wallet-check returned', response.status);
          return;
        }

        const data = await response.json();
        if (data.linked && data.address) {
          console.log('[PaymentFlow] Bot-linked wallet found:', data.address);
          setBotLinkedWallet(data.address);
          persistWallet(data.address); // TM-005: persist for future sessions
          setStep('confirm'); // Skip to confirm if wallet already linked
        }
      } catch (error) {
        console.error('[PaymentFlow] Failed to check bot wallet:', error);
      }
    })();
  }, [isInTelegram, initDataRaw, botApiUrl]);

  // TM-006: Determine initial step.
  // Returning user (persisted wallet OR wallet_linked hint) → confirm directly.
  // First-time user → connect screen.
  const [step, setStep] = useState<PaymentStep>(() => {
    if (isConnected) return 'confirm';
    if (persistedWallet) return 'confirm';
    if (walletLinkedHint) return 'confirm';
    return 'connect';
  });

  // Update step when wallet connects
  useEffect(() => {
    if (isConnected && step === 'connect') {
      if (address) persistWallet(address); // TM-005: persist for returning-user flow
      setStep('confirm');
    }
  }, [isConnected, step, address]);

  // Auto-connect when in wallet's in-app browser (e.g. Braavos injects exactly one provider)
  useEffect(() => {
    if (isConnected || connectingId) return;
    if (availableConnectors.length === 1) {
      console.log('[PaymentFlow] Single connector detected, auto-connecting:', availableConnectors[0].id);
      connect({ connector: availableConnectors[0] });
    }
  }, [isConnected, connectingId, availableConnectors, connect]);

  // Timeout: if injected wallet is detected but connection doesn't succeed
  // within 8 seconds (e.g. Telegram Desktop WebView where extension popups
  // can't open), fall back to redirect buttons.
  useEffect(() => {
    if (isConnected || !hasInjectedWallet()) return;
    const timer = setTimeout(() => {
      console.log('[PaymentFlow] Injected wallet connection timed out — showing redirect buttons');
      setInjectedWalletTimedOut(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Mirror payment phase into local step
  useEffect(() => {
    if (phase === 'idle') return;
    if (
      phase === 'checking-allowance' ||
      phase === 'awaiting-wallet-approval' ||
      phase === 'broadcasting' ||
      phase === 'confirming' ||
      phase === 'notifying-bot'
    ) {
      setStep('processing');
    } else if (phase === 'done') {
      setStep('success');
    } else if (phase === 'error') {
      setStep('error');
    }
  }, [phase]);

  const costEstimate = useCostEstimate(prompt, tier, userModel);
  const tierInfo = COMPUTE_TIERS[tier];

  // Load balance when contract is ready
  useEffect(() => {
    // Update debug info
    setDebugInfo(prev => ({
      ...prev,
      contractReady: isContractReady,
      address: effectiveAddress || null,
    }));

    if (isContractReady && effectiveAddress) {
      console.log('[PaymentFlow] Loading balance... contractReady:', isContractReady, 'effectiveAddress:', effectiveAddress);
      checkBalance(effectiveAddress)
        .then((bal) => {
          console.log('[PaymentFlow] Balance loaded:', bal);
          setBalance(bal);
          setDebugInfo(prev => ({
            ...prev,
            rawBalance: bal,
            balanceError: null,
            address: effectiveAddress,
          }));
        })
        .catch((e) => {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error('[PaymentFlow] Failed to check balance:', e);
          setInitError('Failed to load wallet balance. Please refresh.');
          setDebugInfo(prev => ({
            ...prev,
            rawBalance: null,
            balanceError: errMsg,
          }));
        });
    }
  }, [isContractReady, effectiveAddress, checkBalance]);

  // Handle wallet connection
  const handleConnect = async (connector: any) => {
    if (connectingId) return;
    try {
      setConnectingId(connector.id);
      setInitError(null);
      console.log('[PaymentFlow] Connecting wallet:', connector.id);
      connect({ connector });
      // Step will update via useEffect when isConnected changes
    } catch (e) {
      console.error('[PaymentFlow] Wallet connection failed:', e);
      setInitError('Failed to connect wallet. Please try again.');
    } finally {
      setConnectingId(null);
    }
  };

  // Handle payment — delegates entirely to the strategy layer
  const handlePayment = async () => {
    const result = await pay(
      prompt,
      tier,
      costEstimate.maxEscrowWei,
      chatId,
      messageId,
      paymentNonce,
    );

    if (result.success && result.taskId) {
      clearPaymentContext(); // Clean up stored redirect context
      // Auto-complete after short delay to show success state
      setTimeout(() => {
        onSuccess(result.taskId!);
      }, 1500);
    }
    // Phase-to-step mirroring handled by the useEffect above
  };

  const handleRetry = () => {
    setStep('confirm');
    resetPayment();
  };

  const hasInsufficientBalance = parseFloat(balance) < parseFloat(costEstimate.maxEscrow);

  // Get wallet brand styling
  const getWalletBrand = (connectorId: string) => {
    const id = connectorId.toLowerCase();
    if (id.includes('braavos')) return WALLET_BRANDS.braavos;
    if (id.includes('argent')) return WALLET_BRANDS.argent;
    return {
      bg: 'bg-[var(--surface-elevated)]',
      hoverBg: 'hover:bg-[var(--surface-glass)]',
      text: 'text-white',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
          <circle cx="16" cy="12" r="2" fill="currentColor"/>
        </svg>
      ),
    };
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50, backgroundColor: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="w-full max-w-md bg-[var(--surface-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: '100%', maxWidth: '28rem', borderRadius: '1rem', overflow: 'hidden', animation: 'fadeInScale 0.2s ease-out' }}
      >
        {/* Branded Header */}
        <div
          className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--void)]/50"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          <SmainerLogo />

          {(step === 'connect' || step === 'confirm' || step === 'error') && (
            <button
              onClick={onCancel}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-elevated)] transition-all duration-150"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5">
          {/* Step Header */}
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-white mb-1">
              {step === 'connect' && 'Connect Wallet'}
              {step === 'confirm' && 'Confirm Payment'}
              {step === 'processing' && 'Processing...'}
              {step === 'success' && 'Payment Complete'}
              {step === 'error' && 'Payment Failed'}
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              {step === 'connect' && 'Select your Starknet wallet to continue'}
              {step === 'confirm' && 'Review and approve the transaction'}
              {step === 'processing' && 'Confirming on Starknet...'}
              {step === 'success' && 'Your compute task is starting'}
              {step === 'error' && 'Something went wrong'}
            </p>
          </div>

        {/* Connect Wallet Step */}
          {step === 'connect' && (
            <div className="space-y-4" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Prompt Preview Card */}
              <div className="p-4 rounded-xl bg-[var(--void)] border border-[var(--border-subtle)]" style={{ padding: '16px', borderRadius: '12px' }}>
                <div
                  className="flex items-center justify-between mb-2"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}
                >
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide" style={{ fontSize: '12px', fontWeight: 500, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prompt</span>
                  <span
                    className="px-2 py-0.5 rounded-full bg-[var(--surface-elevated)] text-xs text-[var(--blue)] font-medium"
                    style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', color: '#3B82F6', fontWeight: 500 }}
                  >
                    {tierInfo.name}
                  </span>
                </div>
                <p className="text-white text-sm line-clamp-2 leading-relaxed" style={{ color: 'white', fontSize: '14px', lineHeight: '1.6' }}>{prompt}</p>
              </div>

              {/* Cost Display Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-[var(--blue)]/10 to-transparent border border-[var(--blue)]/20" style={{ padding: '16px', borderRadius: '12px' }}>
                <div
                  className="flex items-center justify-between"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div
                    className="flex items-center gap-2"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div
                      className="w-8 h-8 rounded-full bg-[var(--blue)]/20 flex items-center justify-center"
                      style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <span className="text-[var(--text-secondary)] font-medium" style={{ color: '#D4D4D8', fontWeight: 500 }}>Total Cost</span>
                  </div>
                  <span className="text-xl font-bold text-white" style={{ fontSize: '20px', fontWeight: 700, color: 'white' }}>{costEstimate.maxEscrow} STRK</span>
                </div>
              </div>

              {/* Init Error */}
              {initError && (
                <div className="p-3 rounded-xl bg-[var(--error)]/10 border border-[var(--error)]/20 flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0">
                    <circle cx="12" cy="12" r="10" stroke="var(--error)" strokeWidth="2"/>
                    <path d="M12 8v4M12 16h.01" stroke="var(--error)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span className="text-[var(--error)] text-sm">{initError}</span>
                </div>
              )}

              {/* Skip wallet connectors if bot-linked wallet exists */}
              {!botLinkedWallet && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Select Wallet</span>

                {availableConnectors.length > 0 ? (
                  <div className="space-y-2">
                    {availableConnectors.map((connector) => {
                      const brand = getWalletBrand(connector.id);
                      const isConnecting = connectingId === connector.id;

                      return (
                        <button
                          key={connector.id}
                          onClick={() => handleConnect(connector)}
                          disabled={connectingId !== null}
                          className={`
                            w-full px-4 py-3.5 rounded-xl font-semibold transition-all duration-200
                            flex items-center justify-center gap-3
                            ${brand.bg} ${brand.hoverBg} ${brand.text}
                            disabled:opacity-50 disabled:cursor-not-allowed
                            active:scale-[0.98] shadow-lg
                          `}
                        >
                          {isConnecting ? <Spinner size={20} /> : brand.icon}
                          <span>
                            {isConnecting
                              ? 'Connecting...'
                              : `Connect ${connector.id.charAt(0).toUpperCase() + connector.id.slice(1)}`
                            }
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : hasInjectedWallet() && !injectedWalletTimedOut ? (
                  /* Wallet IS injected (e.g. Braavos in-app browser) but starknet-react
                     hasn't detected it yet — show spinner, auto-connect will fire shortly */
                  <div className="flex items-center justify-center gap-3 py-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '16px 0' }}>
                    <Spinner size={20} />
                    <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Connecting to wallet...</span>
                  </div>
                ) : (
                  <WalletDeepLinks />
                )}
              </div>)}

              {/* Cancel Button */}
              <button
                onClick={onCancel}
                className="w-full px-4 py-3 rounded-xl bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium hover:bg-[var(--surface-glass)] hover:text-white transition-all duration-150"
              >
                Cancel
              </button>
            </div>
          )}

        {/* Confirmation Step */}
          {step === 'confirm' && (
            <div className="space-y-4" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Connected Wallet Display */}
              {effectiveAddress && (
                <div
                  className="p-3 rounded-xl bg-[var(--success)]/10 border border-[var(--success)]/20 flex items-center justify-between"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderRadius: '12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}
                >
                  <div
                    className="flex items-center gap-2"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <div
                      className="w-6 h-6 rounded-full bg-[var(--success)] flex items-center justify-center"
                      style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12l5 5L20 7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <span className="text-sm text-[var(--success)] font-medium" style={{ fontSize: '14px', color: '#22C55E', fontWeight: 500 }}>{address ? 'Connected' : 'Wallet linked via Telegram'}</span>
                  </div>
                  <span className="text-sm text-[var(--text-muted)] font-mono" style={{ fontSize: '14px', color: '#A1A1AA', fontFamily: 'monospace' }}>{formatAddress(effectiveAddress)}</span>
                </div>
              )}

              {/* Cost Breakdown Card */}
              <div className="p-4 rounded-xl bg-[var(--void)] border border-[var(--border-subtle)] space-y-3" style={{ padding: '16px', borderRadius: '12px' }}>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-xs uppercase tracking-wide" style={{ color: '#A1A1AA', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost Estimate</span>
                  <span className="text-[var(--text-muted)] text-xs font-mono" style={{ color: '#71717A', fontSize: '11px', fontFamily: 'monospace' }}>{userModel}</span>
                </div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Input tokens</span>
                  <span className="text-[var(--text-secondary)] text-sm font-mono" style={{ color: '#D4D4D8', fontSize: '14px', fontFamily: 'monospace' }}>~{costEstimate.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Effort estimate</span>
                  <span className="text-[var(--text-secondary)] text-sm font-mono" style={{ color: '#D4D4D8', fontSize: '14px', fontFamily: 'monospace' }}>{costEstimate.estimatedEffort.toFixed(2)}x</span>
                </div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Compute tier</span>
                  <span className="text-white text-sm font-medium flex items-center gap-1.5" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontSize: '14px', fontWeight: 500 }}>
                    <span className="w-2 h-2 rounded-full bg-[var(--blue)]" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6' }}></span>
                    {tierInfo.name}
                    <span className="text-[var(--text-muted)]" style={{ color: '#A1A1AA' }}>(×{tierInfo.multiplier})</span>
                  </span>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Estimated actual</span>
                  <span className="text-[var(--text-secondary)] text-sm font-mono" style={{ color: '#D4D4D8', fontSize: '14px', fontFamily: 'monospace' }}>~{costEstimate.estimatedActual} STRK</span>
                </div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-white text-sm font-semibold" style={{ color: 'white', fontSize: '14px', fontWeight: 600 }}>Max escrow</span>
                  <span className="text-white font-bold text-lg" style={{ color: 'white', fontWeight: 700, fontSize: '18px' }}>{costEstimate.maxEscrow} STRK</span>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Your balance</span>
                  <span
                    className={`font-semibold text-sm ${hasInsufficientBalance ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}
                    style={{ fontWeight: 600, fontSize: '14px', color: hasInsufficientBalance ? '#EF4444' : '#22C55E' }}
                  >
                    {balance} STRK
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pt-1" style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#22C55E" strokeWidth="2"/>
                  </svg>
                  <span className="text-[var(--success)] text-xs" style={{ color: '#22C55E', fontSize: '12px' }}>Excess refunded automatically after task completes.</span>
                </div>
              </div>

              {/* Prompt Preview */}
              <div className="p-4 rounded-xl bg-[var(--void)] border border-[var(--border-subtle)]">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide block mb-2">Prompt</span>
                <p className="text-white text-sm line-clamp-3 leading-relaxed">{prompt}</p>
              </div>

              {/* Bot-linked wallet detail (only when not overridden by MiniApp connection) */}
              {!address && botLinkedWallet && (
                <div className="p-4 rounded-xl bg-[var(--surface-elevated)] border border-[var(--blue)]/30">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">
                    Wallet (Linked via Telegram)
                  </p>
                  <p className="text-white font-mono text-sm break-all">
                    {botLinkedWallet}
                  </p>
                </div>
              )}


              {/* Insufficient Balance Warning */}
              {hasInsufficientBalance && (
                <div className="p-4 rounded-xl bg-[var(--error)]/10 border border-[var(--error)]/20">
                  <div className="flex items-center gap-2 mb-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="var(--error)" strokeWidth="2"/>
                      <path d="M15 9l-6 6M9 9l6 6" stroke="var(--error)" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span className="text-[var(--error)] font-semibold">Insufficient Balance</span>
                  </div>
                  <p className="text-[var(--error)] text-sm opacity-80 ml-6">
                    You need {costEstimate.maxEscrow} STRK. Current balance: {balance} STRK
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              {capabilities.requiresRedirect && !hasInjectedWallet() ? (
                <div
                  className="flex flex-col gap-3 pt-2"
                  style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}
                >
                  {/* Wallet deep link buttons — only when NOT in a wallet's browser */}
                  <WalletPayButtons />

                  <button
                    onClick={onCancel}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium hover:bg-[var(--surface-glass)] hover:text-white transition-all duration-150"
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', fontWeight: 500, border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : capabilities.requiresRedirect && hasInjectedWallet() && !injectedWalletTimedOut ? (
                /* Wallet IS injected (Braavos/Argent in-app browser) — go back to connect step */
                <div className="flex flex-col gap-3 pt-2" style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                  <div className="flex items-center justify-center gap-3 py-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '16px 0' }}>
                    <Spinner size={20} />
                    <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Connecting to wallet...</span>
                  </div>
                  <button
                    onClick={onCancel}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium hover:bg-[var(--surface-glass)] hover:text-white transition-all duration-150"
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', fontWeight: 500, border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div
                  className="flex gap-3 pt-2"
                  style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}
                >
                  <button
                    onClick={onCancel}
                    className="flex-1 px-4 py-3.5 rounded-xl bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium hover:bg-[var(--surface-glass)] hover:text-white transition-all duration-150"
                    style={{ flex: 1, padding: '14px 16px', borderRadius: '12px', fontWeight: 500, border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePayment}
                    disabled={hasInsufficientBalance || !isContractReady || !account || isLoading}
                    className="flex-1 px-4 py-3.5 rounded-xl bg-[var(--blue)] text-white font-semibold hover:bg-[var(--blue-hover)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                    style={{ flex: 1, padding: '14px 16px', borderRadius: '12px', background: '#3B82F6', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (hasInsufficientBalance || !isContractReady || !account || isLoading) ? 0.4 : 1 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {capabilities.ctaLabel}
                  </button>
                </div>
              )}

              {/* Debug Panel - tap version to toggle */}
              <div className="mt-4">
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors font-mono"
                >
                  v{BUILD_VERSION} {showDebug ? '▲' : '▼'}
                </button>

                {showDebug && (
                  <div className="mt-2 p-3 rounded-lg bg-black/40 border border-[var(--border-subtle)] text-xs font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Address:</span>
                      <span className="text-white break-all">{debugInfo.address || 'Not connected'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Contract Ready:</span>
                      <span className={debugInfo.contractReady ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
                        {debugInfo.contractReady ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Raw Balance:</span>
                      <span className="text-white">{debugInfo.rawBalance ?? 'Loading...'}</span>
                    </div>
                    {debugInfo.balanceError && (
                      <div className="pt-1 border-t border-[var(--border-subtle)]">
                        <span className="text-[var(--error)]">Error: {debugInfo.balanceError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Processing Step */}
          {step === 'processing' && (
            <div className="py-8 text-center space-y-5">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-[var(--blue)] to-[#60A5FA] flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Spinner size={32} />
              </div>
              <div>
                <h4 className="text-lg font-semibold text-white mb-2">
                  Processing Transaction
                </h4>
                <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto">
                  Approving tokens and creating your compute task on Starknet...
                </p>
              </div>
              <div className="flex justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--blue)] animate-pulse"></span>
                <span className="w-2 h-2 rounded-full bg-[var(--blue)] animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-2 h-2 rounded-full bg-[var(--blue)] animate-pulse" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}

        {/* Success Step */}
          {step === 'success' && (
            <div className="py-8 text-center space-y-5">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-[var(--success)] flex items-center justify-center shadow-lg shadow-green-500/30">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12l5 5L20 7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="text-lg font-semibold text-white mb-2">
                  Payment Confirmed!
                </h4>
                <p className="text-[var(--text-muted)] text-sm">
                  Task ID: <span className="font-mono text-white">{taskId ? taskId.slice(0, 8) + '...' : '...'}</span>
                </p>
                <p className="text-[var(--success)] text-sm mt-2 flex items-center justify-center gap-2">
                  <Spinner size={14} />
                  Starting compute...
                </p>
              </div>

              {/* Escrow / refund summary */}
              <div
                className="w-full rounded-xl bg-[var(--void)] border border-[var(--border-subtle)] p-4 space-y-2 text-left"
                style={{ borderRadius: '12px', padding: '16px' }}
              >
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Escrowed</span>
                  <span className="text-white text-sm font-mono" style={{ color: 'white', fontSize: '14px', fontFamily: 'monospace' }}>{costEstimate.maxEscrow} STRK</span>
                </div>
                <div className="flex justify-between items-center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>Estimated actual</span>
                  <span className="text-[var(--text-secondary)] text-sm font-mono" style={{ color: '#D4D4D8', fontSize: '14px', fontFamily: 'monospace' }}>~{costEstimate.estimatedActual} STRK</span>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <div className="flex items-center gap-1.5" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#22C55E" strokeWidth="2"/>
                  </svg>
                  <span className="text-[var(--success)] text-xs" style={{ color: '#22C55E', fontSize: '12px' }}>Excess refunded automatically after task completes.</span>
                </div>
              </div>

              {/* Return to Telegram — shown when in wallet's browser, not in Telegram WebView */}
              {!isInTelegram && (
                <button
                  onClick={() => window.location.assign('https://t.me/smainer_ai_bot')}
                  className="w-full py-3.5 px-5 rounded-xl font-semibold text-sm"
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #B5A082, #D4C4A8)',
                    color: '#000',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Return to Telegram
                </button>
              )}
            </div>
          )}

        {/* Error Step */}
          {step === 'error' && (
            <div className="space-y-5">
              <div className="py-6 text-center">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-[var(--error)]/20 flex items-center justify-center mb-4">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="var(--error)" strokeWidth="2"/>
                    <path d="M15 9l-6 6M9 9l6 6" stroke="var(--error)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
                <h4 className="text-lg font-semibold text-white mb-2">
                  Payment Failed
                </h4>
                <p className="text-[var(--error)] text-sm max-w-xs mx-auto">
                  {errorMessage || 'Transaction was rejected or failed. Please try again.'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 px-4 py-3.5 rounded-xl bg-[var(--surface-elevated)] text-[var(--text-secondary)] font-medium hover:bg-[var(--surface-glass)] hover:text-white transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRetry}
                  className="flex-1 px-4 py-3.5 rounded-xl bg-[var(--blue)] text-white font-semibold hover:bg-[var(--blue-hover)] transition-all duration-150 flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
