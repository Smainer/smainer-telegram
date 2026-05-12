/**
 * OneTapApprove.tsx — One-tap STRK approval flow for Telegram bot
 * 
 * Flow:
 * 1. Read chat_id from URL params
 * 2. User connects wallet (Braavos/Argent)
 * 3. Call POST /api/v1/sessions/wallet to get dust + spender + amount
 * 4. Fire approve(spender, amount_wei + dust) tx
 * 5. Close MiniApp after tx submitted
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAccount, useConnect, useDisconnect } from '@starknet-react/core';
import { Contract, RpcProvider, CallData, uint256 } from 'starknet';
import { useTelegramData } from '@/hooks/useTelegramData';
import { CONTRACT_ADDRESSES, SMAINER_TOKEN_ABI } from '@/lib/starknet';

const RELAYER_API_URL = import.meta.env.VITE_RELAYER_API_URL || 'http://localhost:8000';
const RELAYER_API_KEY = import.meta.env.VITE_RELAYER_API_KEY || '';

// Build version for debugging
const BUILD_VERSION = '2026-05-12-one-tap-v2';
const STRK_WEI = 1_000_000_000_000_000_000n;

interface SessionWalletResponse {
  dust_value: number;
  spender_address: string;
  amount_to_approve_strk?: number | string;
  amount_to_approve_wei?: number | string;
  amount_to_approve_display?: string;
}

function extractIntegerField(rawJson: string, fieldName: string): string | null {
  const match = rawJson.match(new RegExp(`"${fieldName}"\\s*:\\s*"?(\\d+)"?`));
  return match?.[1] ?? null;
}

function normalizeAmountWei(rawAmount: string): bigint {
  const parsed = BigInt(rawAmount);
  // Legacy relayer sessions returned whole STRK. New sessions store wei.
  return parsed > 1_000_000_000_000n ? parsed : parsed * STRK_WEI;
}

function formatStrkFromWei(amountWei: bigint): string {
  const whole = amountWei / STRK_WEI;
  const fractional = amountWei % STRK_WEI;
  if (fractional === 0n) return whole.toString();
  return `${whole}.${fractional.toString().padStart(18, '0').replace(/0+$/, '')}`;
}

function buildBraavosApproveUrl(chatId: string): string {
  return `https://link.braavos.app/dapp/smainer-miniapp.vercel.app/approve/${encodeURIComponent(chatId)}`;
}

type FlowStep = 'loading' | 'connect' | 'approving' | 'success' | 'error';

export function OneTapApprove() {
  const [searchParams] = useSearchParams();
  const routeParams = useParams<{ chatId?: string }>();
  const chatId = routeParams.chatId || searchParams.get('chat_id');
  
  const { address, account, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { miniApp, isInTelegram } = useTelegramData();
  
  const [step, setStep] = useState<FlowStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionWalletResponse | null>(null);

  // Detect available wallet connectors
  const availableConnectors = connectors.filter(c => c.available());
  const hasBraavos = availableConnectors.some(c => c.id === 'braavos');
  const hasArgent = availableConnectors.some(c => c.id === 'argentX');
  const hasAnyWallet = hasBraavos || hasArgent;

  // Initialize — check if chat_id is valid
  useEffect(() => {
    if (!chatId) {
      setError('Missing chat_id parameter. Open this link from Telegram.');
      setStep('error');
      return;
    }
    
    // Ready to connect wallet
    if (isConnected && address) {
      registerWalletAndApprove();
    } else {
      setStep('connect');
    }
  }, [chatId]);

  // When wallet connects, register it and trigger approve
  useEffect(() => {
    if (isConnected && address && step === 'connect') {
      registerWalletAndApprove();
    }
  }, [isConnected, address, step]);

  const registerWalletAndApprove = useCallback(async () => {
    if (!chatId || !address || !account) return;
    
    setStep('approving');
    setError(null);

    try {
      // Step 1: Register wallet with relayer
      const walletRes = await fetch(`${RELAYER_API_URL}/api/v1/sessions/wallet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(RELAYER_API_KEY && {
            'Authorization': `Bearer ${RELAYER_API_KEY}`,
            'X-API-Key': RELAYER_API_KEY,
          }),
        },
        body: JSON.stringify({
          chat_id: chatId,
          wallet_address: address,
        }),
      });

      if (!walletRes.ok) {
        const errText = await walletRes.text();
        throw new Error(`Relayer error: ${walletRes.status} - ${errText}`);
      }

      const rawSession = await walletRes.text();
      const session: SessionWalletResponse = JSON.parse(rawSession);
      const amountRaw = (
        extractIntegerField(rawSession, 'amount_to_approve_wei')
        || extractIntegerField(rawSession, 'amount_to_approve_strk')
        || String(session.amount_to_approve_wei || session.amount_to_approve_strk || '0')
      );
      const amountWei = normalizeAmountWei(amountRaw);
      const dustRaw = extractIntegerField(rawSession, 'dust_value') || String(session.dust_value || 0);
      const dustWei = BigInt(dustRaw);
      const totalApproveWei = amountWei + dustWei;
      const displayAmount = formatStrkFromWei(amountWei);
      setSessionData({ ...session, amount_to_approve_display: displayAmount });
      console.log('[OneTapApprove] Session data:', session);

      console.log('[OneTapApprove] Approve amount:', {
        amountStrk: displayAmount,
        dustValue: dustRaw,
        totalWei: totalApproveWei.toString(),
      });

      // Step 3: Fire approve transaction
      const strkContract = new Contract(
        SMAINER_TOKEN_ABI as any,
        CONTRACT_ADDRESSES.STRK_TOKEN,
        account
      );

      // Convert to Uint256 format for starknet.js
      const approveAmountU256 = uint256.bnToUint256(totalApproveWei);

      const tx = await strkContract.approve(
        session.spender_address,
        approveAmountU256
      );

      setTxHash(tx.transaction_hash);
      setStep('success');
      console.log('[OneTapApprove] Approve tx submitted:', tx.transaction_hash);

      // Auto-close after short delay
      setTimeout(() => {
        if (miniApp) {
          miniApp.close();
        }
      }, 2000);

    } catch (err) {
      console.error('[OneTapApprove] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('error');
    }
  }, [chatId, address, account, miniApp]);

  const handleConnect = (connectorId: string) => {
    const connector = connectors.find(c => c.id === connectorId);
    if (connector) {
      connect({ connector });
    }
  };

  const handleRetry = () => {
    setError(null);
    if (isConnected && address) {
      registerWalletAndApprove();
    } else {
      setStep('connect');
    }
  };

  const openInBrowser = () => {
    if (!chatId) return;
    const walletUrl = buildBraavosApproveUrl(chatId);
    if (miniApp) {
      (window.Telegram?.WebApp as any)?.openLink?.(walletUrl);
    } else {
      window.location.href = walletUrl;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Approve Payment</h1>
          <span className="text-xs text-white/40">{BUILD_VERSION}</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {step === 'loading' && (
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/60">Loading...</p>
          </div>
        )}

        {step === 'connect' && (
          <div className="w-full max-w-sm space-y-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">Connect Wallet</h2>
              <p className="text-white/60 text-sm">
                Connect your Starknet wallet to approve the payment
              </p>
            </div>

            {hasAnyWallet ? (
              <div className="space-y-3">
                {hasBraavos && (
                  <button
                    onClick={() => handleConnect('braavos')}
                    className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Connect Braavos</span>
                  </button>
                )}
                {hasArgent && (
                  <button
                    onClick={() => handleConnect('argentX')}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Connect Argent X</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-white/60 text-sm">
                  No wallet detected in Telegram. Open this approval in Braavos to continue.
                </p>
                <button
                  onClick={openInBrowser}
                  className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 rounded-xl font-medium transition-colors"
                >
                  Open Braavos
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'approving' && (
          <div className="text-center">
            <div className="animate-spin w-12 h-12 border-3 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Approving Payment</h2>
            <p className="text-white/60 text-sm mb-4">
              Please confirm the transaction in your wallet
            </p>
            {sessionData && (
              <div className="bg-white/5 rounded-xl p-4 text-left text-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-white/60">Amount:</span>
                  <span>{sessionData.amount_to_approve_display || sessionData.amount_to_approve_strk} STRK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Chat ID:</span>
                  <span className="font-mono">{chatId}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Approval Submitted!</h2>
            <p className="text-white/60 text-sm mb-4">
              Your payment approval has been sent. The bot will process your request shortly.
            </p>
            {txHash && (
              <p className="text-xs text-white/40 font-mono break-all">
                TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </p>
            )}
            <p className="text-white/40 text-sm mt-4">
              Closing automatically...
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center w-full max-w-sm">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Something Went Wrong</h2>
            <p className="text-white/60 text-sm mb-4">{error}</p>
            <button
              onClick={handleRetry}
              className="w-full py-3 px-4 bg-blue-500 hover:bg-blue-600 rounded-xl font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 text-center text-xs text-white/30">
        Smainer — Private AI Compute on Starknet
      </div>
    </div>
  );
}
