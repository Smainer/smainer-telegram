import { useState, useMemo, useCallback } from 'react';
import { useAccount } from '@starknet-react/core';
import { useTelegramData } from './useTelegramData';
import { useSmainerContract } from './useSmainerContract';
import {
  createPaymentStrategy,
  resolveEnvironment,
} from '@/payment/factory';
import type {
  PaymentPhase,
  PaymentContext,
  PaymentResult,
  StrategyCapabilities,
  PaymentEnvironment,
} from '@/payment/types';

// -------------------------------------------------------------------------
// Telegram WebView detection
// -------------------------------------------------------------------------

function detectTelegramWebView(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    !!(window as any).Telegram?.WebApp ||
    navigator.userAgent.includes('Telegram')
  );
}

// -------------------------------------------------------------------------
// Hook return type
// -------------------------------------------------------------------------

export interface UsePaymentReturn {
  /** Current execution phase */
  phase: PaymentPhase;
  /** Transaction hash once broadcasting completes */
  txHash: string | undefined;
  /** On-chain task ID once confirmed */
  taskId: string | undefined;
  /** Human-readable error message on failure */
  errorMessage: string | undefined;
  /** True while a payment is in flight */
  isLoading: boolean;
  /** Capabilities of the active strategy (used to adapt CTA label / flow) */
  capabilities: StrategyCapabilities;
  /** Resolved environment for this session */
  environment: PaymentEnvironment;
  /**
   * Initiate the payment.
   * @param prompt     User's inference prompt
   * @param tier       Compute tier
   * @param escrowWei  Max escrow amount in wei (bigint)
   * @param chatId     Telegram chat ID
   * @param messageId  Telegram message ID
   * @param nonce      Bot-issued payment nonce (standalone browser auth)
   */
  pay: (
    prompt: string,
    tier: Parameters<typeof createPaymentStrategy>[0]['checkAllowance'] extends () => Promise<bigint>
      ? import('@/lib/starknet').ComputeTier
      : never,
    escrowWei: bigint,
    chatId: string | null,
    messageId: string | null,
    nonce?: string,
  ) => Promise<PaymentResult>;
  /** Reset phase back to idle (e.g. after error → retry) */
  reset: () => void;
}

// -------------------------------------------------------------------------
// Hook implementation
// -------------------------------------------------------------------------

export function usePayment(
  botLinkedWallet: string | null = null,
): UsePaymentReturn {
  const { account } = useAccount();
  const { initDataRaw: tgInitData } = useTelegramData();
  const { checkAllowance } = useSmainerContract();

  // When running outside Telegram WebView (e.g. Braavos in-app browser after
  // redirect), fall back to the initData stored before the redirect.
  const initDataRaw = useMemo(() => {
    if (tgInitData) return tgInitData;
    try {
      const raw = window.localStorage.getItem('smainer_pending_payment');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.initDataRaw || undefined;
      }
    } catch {
      // Ignore — best-effort fallback.
    }
    return undefined;
  }, [tgInitData]);

  const botApiUrl =
    (import.meta.env as Record<string, string>).VITE_BOT_API_URL ||
    'https://bot.smainer.io';

  // Detect environment once — stable across re-renders
  const isTelegramWebView = useMemo(() => detectTelegramWebView(), []);

  const environment = useMemo<PaymentEnvironment>(
    () =>
      resolveEnvironment({
        isTelegramWebView,
        account: account ?? undefined,
        botLinkedWallet,
      }),
    [isTelegramWebView, account, botLinkedWallet],
  );

  // Payment state
  const [phase, setPhase] = useState<PaymentPhase>('idle');
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // Capabilities come from a temporary strategy instance — pure, no side effects
  const capabilities = useMemo<StrategyCapabilities>(() => {
    const strategy = createPaymentStrategy({
      isTelegramWebView,
      account: account ?? undefined,
      botLinkedWallet,
      checkAllowance,
      onProgress: () => {},
    });
    return strategy.getCapabilities();
  }, [isTelegramWebView, account, botLinkedWallet, checkAllowance]);

  const reset = useCallback(() => {
    setPhase('idle');
    setTxHash(undefined);
    setTaskId(undefined);
    setErrorMessage(undefined);
  }, []);

  const pay = useCallback(
    async (
      prompt: string,
      tier: import('@/lib/starknet').ComputeTier,
      escrowWei: bigint,
      chatId: string | null,
      messageId: string | null,
      nonce?: string,
    ): Promise<PaymentResult> => {
      // Reset state before starting
      setPhase('idle');
      setTxHash(undefined);
      setTaskId(undefined);
      setErrorMessage(undefined);

      const ctx: PaymentContext = {
        prompt,
        tier,
        escrowAmountWei: escrowWei,
        effectiveAddress: (account as any)?.address ?? botLinkedWallet ?? undefined,
        chatId,
        messageId,
        initDataRaw,
        botApiUrl,
        nonce: nonce || '',
      };

      const strategy = createPaymentStrategy({
        isTelegramWebView,
        account: account ?? undefined,
        botLinkedWallet,
        checkAllowance,
        onProgress: (progress) => {
          setPhase(progress.phase);
          if (progress.txHash !== undefined) setTxHash(progress.txHash);
          if (progress.taskId !== undefined) setTaskId(progress.taskId);
          if (progress.errorMessage !== undefined) setErrorMessage(progress.errorMessage);
        },
      });

      const result = await strategy.execute(ctx);

      // Reconcile final state from result in case the last onProgress
      // didn't carry all fields.
      if (result.txHash) setTxHash(result.txHash);
      if (result.taskId) setTaskId(result.taskId);
      if (result.errorMessage && !result.success) setErrorMessage(result.errorMessage);

      return result;
    },
    [account, botLinkedWallet, initDataRaw, botApiUrl, isTelegramWebView, checkAllowance],
  );

  const isLoading =
    phase !== 'idle' && phase !== 'done' && phase !== 'error';

  return {
    phase,
    txHash,
    taskId,
    errorMessage,
    isLoading,
    capabilities,
    environment,
    pay: pay as UsePaymentReturn['pay'],
    reset,
  };
}
