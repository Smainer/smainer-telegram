import { useState, useEffect, useMemo } from 'react';
import { useAccount, useConnect } from '@starknet-react/core';
import { useSmainerContract } from '@/hooks/useSmainerContract';
import { ComputeTier, COMPUTE_TIERS } from '@/lib/starknet';
import { useTelegramData } from '@/hooks/useTelegramData';

// Version for deployment verification (increment on each deploy)
const BUILD_VERSION = '2026-03-27-v8';

// Single-tap "Open in Browser" for Telegram WebView (replaces copy-link mess)
function WalletDeepLinks() {
  const handleOpenInBrowser = () => {
    const url = `https://smainer-miniapp.vercel.app${window.location.pathname}${window.location.search}`;
    // Haptic feedback
    try {
      (window.Telegram?.WebApp as any)?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      // Haptic feedback not available
    }
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div 
      style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '24px 16px' }}
      className="flex flex-col gap-4 items-center p-6"
    >
      {/* Wallet Icon */}
      <div 
        style={{ 
          width: '48px', 
          height: '48px', 
          borderRadius: '12px', 
          background: 'rgba(59,130,246,0.15)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}
        className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" stroke="#3B82F6" strokeWidth="2" fill="none"/>
          <path d="M12 22V12M4 7l8 5 8-5" stroke="#3B82F6" strokeWidth="2"/>
        </svg>
      </div>
      
      {/* Explanation */}
      <p 
        style={{ color: '#A1A1AA', fontSize: '14px', textAlign: 'center', margin: '0' }}
        className="text-zinc-400 text-sm text-center m-0"
      >
        Wallet extensions require a full browser
      </p>
      
      {/* Single Action Button */}
      <button
        onClick={handleOpenInBrowser}
        style={{
          width: '100%',
          padding: '14px 24px',
          borderRadius: '12px',
          background: '#3B82F6',
          color: 'white',
          border: 'none',
          fontSize: '16px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
        className="w-full px-6 py-3.5 rounded-xl bg-blue-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Open in Browser
      </button>
      
      {/* Security note */}
      <p 
        style={{ 
          color: '#71717A', 
          fontSize: '12px', 
          textAlign: 'center', 
          margin: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px'
        }}
        className="text-zinc-500 text-xs text-center m-0 flex items-center justify-center gap-1.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2"/>
        </svg>
        Then connect Argent or Braavos
      </p>
    </div>
  );
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
  const [taskId, setTaskId] = useState<string>('');
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
  
  // Get bot API and telegram data
  const { initDataRaw, isInTelegram } = useTelegramData();
  const botApiUrl = import.meta.env.VITE_BOT_API_URL || 'https://bot.smainer.io';

  // Read URL parameters for Telegram integration
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id');
  const messageId = searchParams.get('message_id');

  // Wallet connection hooks
  const { address, account, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Prioritize MiniApp-connected wallet; fall back to bot-linked wallet for read-only ops
  const effectiveAddress = useMemo(() => address || botLinkedWallet, [address, botLinkedWallet]);

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
    createTask,
    checkBalance,
    getPromptCostForTier,
    error,
    isContractReady,
    resetTxState
  } = useSmainerContract();

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
          setStep('confirm'); // Skip to confirm if wallet already linked
        }
      } catch (error) {
        console.error('[PaymentFlow] Failed to check bot wallet:', error);
      }
    })();
  }, [isInTelegram, initDataRaw, botApiUrl]);

  // Determine initial step based on wallet connection
  const [step, setStep] = useState<PaymentStep>(() => {
    return isConnected ? 'confirm' : 'connect';
  });

  // Update step when wallet connects
  useEffect(() => {
    if (isConnected && step === 'connect') {
      setStep('confirm');
    }
  }, [isConnected, step]);

  const promptCost = getPromptCostForTier(tier);
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
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error('[PaymentFlow] Failed to check balance:', e);
          setInitError('Failed to load wallet balance. Please refresh.');
          setDebugInfo(prev => ({
            ...prev,
            rawBalance: null,
            balanceError: errorMsg,
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

  // Handle payment process
  const handlePayment = async () => {
    setStep('processing');
    resetTxState();

    try {
      const result = await createTask(prompt, tier, effectiveAddress ?? undefined);
      
      if (result.success && result.taskId) {
        setTaskId(result.taskId);
        setStep('success');
        
        // Send data back to Telegram bot
        try {
          const webAppData = JSON.stringify({
            action: 'payment_complete',
            on_chain_task_id: result.taskId,
            prompt,
            tier,
            chat_id: chatId,
            message_id: messageId,
            starknet_address: effectiveAddress,
          });
          window.Telegram?.WebApp?.sendData?.(webAppData);
        } catch (e) {
          console.error('Failed to send data to Telegram:', e);
        }
        
        // Auto-complete after short delay to show success state
        // Note: sendData() closes the MiniApp automatically, but keep as fallback
        setTimeout(() => {
          onSuccess(result.taskId!);
        }, 1500);
      } else {
        setStep('error');
      }
    } catch (err) {
      console.error('Payment failed:', err);
      setStep('error');
    }
  };

  const handleRetry = () => {
    setStep('confirm');
    resetTxState();
  };

  const hasInsufficientBalance = parseFloat(balance) < parseFloat(promptCost);

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
                  <span className="text-xl font-bold text-white" style={{ fontSize: '20px', fontWeight: 700, color: 'white' }}>{promptCost} STRK</span>
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
                <div 
                  className="flex justify-between items-center"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span className="text-[var(--text-muted)]" style={{ color: '#A1A1AA' }}>Compute Tier</span>
                  <span 
                    className="text-white font-medium flex items-center gap-1.5"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'white', fontWeight: 500 }}
                  >
                    <span className="w-2 h-2 rounded-full bg-[var(--blue)]" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6' }}></span>
                    {tierInfo.name}
                    <span className="text-[var(--text-muted)] text-sm" style={{ color: '#A1A1AA', fontSize: '14px' }}>(×{tierInfo.multiplier})</span>
                  </span>
                </div>
                <div 
                  className="flex justify-between items-center"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span className="text-[var(--text-muted)]" style={{ color: '#A1A1AA' }}>Cost</span>
                  <span className="text-white font-bold text-lg" style={{ color: 'white', fontWeight: 700, fontSize: '18px' }}>{promptCost} STRK</span>
                </div>
                <div className="h-px bg-[var(--border-subtle)]" style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                <div 
                  className="flex justify-between items-center"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span className="text-[var(--text-muted)]" style={{ color: '#A1A1AA' }}>Your Balance</span>
                  <span 
                    className={`font-semibold ${hasInsufficientBalance ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}
                    style={{ fontWeight: 600, color: hasInsufficientBalance ? '#EF4444' : '#22C55E' }}
                  >
                    {balance} STRK
                  </span>
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
                    You need {promptCost} STRK. Current balance: {balance} STRK
                  </p>
                </div>
              )}

              {/* Action Buttons */}
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
                {!account && botLinkedWallet && !hasInsufficientBalance ? (
                  <button
                    onClick={() => {
                      const payUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
                      try {
                        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                      } catch {}
                      if ((window as any).Telegram?.WebApp?.openLink) {
                        (window as any).Telegram.WebApp.openLink(payUrl);
                      } else {
                        window.open(payUrl, '_blank');
                      }
                    }}
                    className="flex-1 px-4 py-3.5 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-lg"
                    style={{ flex: 1, padding: '14px 16px', borderRadius: '12px', background: '#3B82F6', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Open in Browser to Pay
                  </button>
                ) : (
                  <button
                    onClick={handlePayment}
                    disabled={hasInsufficientBalance || !isContractReady || !account}
                    className="flex-1 px-4 py-3.5 rounded-xl bg-[var(--blue)] text-white font-semibold hover:bg-[var(--blue-hover)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                    style={{ flex: 1, padding: '14px 16px', borderRadius: '12px', background: '#3B82F6', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (hasInsufficientBalance || !isContractReady || !account) ? 0.4 : 1 }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Approve & Pay
                  </button>
                )}
              </div>
              
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
                  Task ID: <span className="font-mono text-white">{taskId.slice(0, 8)}...</span>
                </p>
                <p className="text-[var(--success)] text-sm mt-2 flex items-center justify-center gap-2">
                  <Spinner size={14} />
                  Starting compute...
                </p>
              </div>
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
                  {error || 'Transaction was rejected or failed. Please try again.'}
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