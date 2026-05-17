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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAccount, useConnect } from '@starknet-react/core';
import { useTelegramData } from '@/hooks/useTelegramData';
import { CONTRACT_ADDRESSES } from '@/lib/starknet';

import {
  resolveRelayerBaseUrl,
  validateOneTapUrlContext,
  buildSessionWalletHeaders,
  buildStrkApproveCall,
  getApprovalCredentialMode,
  parseSessionWallet,
  buildBraavosApproveUrl,
  resolveApprovalCredential,
  type SessionWalletResponse,
} from '@/lib/oneTapApprove';

// Build version for debugging
const BUILD_VERSION = '2026-05-17-one-tap-raw-approve';

type FlowStep = 'loading' | 'connect' | 'approving' | 'success' | 'error';

export function OneTapApprove() {
  const [searchParams] = useSearchParams();
  const routeParams = useParams<{ chatId?: string; credential?: string }>();
  const chatId = routeParams.chatId || searchParams.get('chat_id');

  const rawCredentialFromQuery =
    searchParams.get('token') ?? searchParams.get('one_tap_code') ?? searchParams.get('code');

  const approvalCredential = resolveApprovalCredential({
    credentialFromPath: routeParams.credential,
    credentialFromQuery: rawCredentialFromQuery,
  });

  const credentialMode = useMemo(() => {
    if (!approvalCredential) return null;
    return getApprovalCredentialMode(approvalCredential);
  }, [approvalCredential]);

  const relayerBaseUrl = useMemo(() => {
    try {
      return resolveRelayerBaseUrl(import.meta.env as any);
    } catch {
      return null;
    }
  }, []);
  
  const { address, account, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { miniApp } = useTelegramData();
  
  const [step, setStep] = useState<FlowStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionWalletResponse | null>(null);

  useEffect(() => {
    (globalThis as any).__SMAINER_BUILD_VERSION__ = BUILD_VERSION;
  }, []);

  // Detect available wallet connectors
  const availableConnectors = connectors.filter(c => c.available());
  const hasBraavos = availableConnectors.some(c => c.id === 'braavos');
  const hasArgent = availableConnectors.some(c => c.id === 'argentX');
  const hasAnyWallet = hasBraavos || hasArgent;

  const registerWalletAndApprove = useCallback(async () => {
    const validation = validateOneTapUrlContext({ chatId, credential: approvalCredential });
    if (!validation.ok) {
      setError(validation.message);
      setStep('error');
      return;
    }
    if (!relayerBaseUrl) {
      setError(
        'Relayer URL is misconfigured. Set VITE_RELAYER_URL to a full https:// URL (example: https://api.smainer.io).'
      );
      setStep('error');
      return;
    }
    if (!address || !account) return;

    setStep('approving');
    setError(null);

    try {
      // Step 1: Register wallet with relayer
      const walletRes = await fetch(`${relayerBaseUrl}/api/v1/sessions/wallet`, {
        method: 'POST',
        headers: buildSessionWalletHeaders(approvalCredential!),
        body: JSON.stringify({
          chat_id: chatId,
          wallet_address: address,
        }),
      });

      if (!walletRes.ok) {
        // Actionable token/session errors vs network/CORS.
        if (walletRes.status === 401 || walletRes.status === 403) {
          throw new Error(
            'This approval link is expired or invalid. Go back to Telegram and open the latest approval button again.'
          );
        }
        if (walletRes.status === 404) {
          throw new Error(
            'Approval session was not found. Go back to Telegram and open the latest approval button again.'
          );
        }
        if (walletRes.status === 409) {
          throw new Error(
            'This approval link was already used. Go back to Telegram and request a new approval.'
          );
        }
        throw new Error(`Relayer error (HTTP ${walletRes.status}). Please retry in a moment.`);
      }

      const rawSession = await walletRes.text();
      const { session, totalApproveWei } = parseSessionWallet(rawSession);
      setSessionData(session);

      // Step 3: Fire approve transaction. Use raw calldata to avoid simplified
      // ABI type-string drift across starknet.js versions.
      const tx = await account.execute([
        buildStrkApproveCall({
          strkTokenAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
          spenderAddress: session.spender_address,
          amountWei: totalApproveWei,
        }),
      ]);

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
      // Avoid logging one-tap tokens or request headers.
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.toLowerCase().includes('fetch')) {
        setError(
          'Network error reaching the relayer (possible CORS/network issue). Check your connection and try again.'
        );
      } else {
        setError(message);
      }
      setStep('error');
    }
  }, [chatId, approvalCredential, relayerBaseUrl, address, account, miniApp]);

  // Initialize — validate URL context (chat id + approval credential)
  useEffect(() => {
    const validation = validateOneTapUrlContext({ chatId, credential: approvalCredential });
    if (!validation.ok) {
      setError(validation.message);
      setStep('error');
      return;
    }

    if (!relayerBaseUrl) {
      setError(
        'Relayer URL is misconfigured. Set VITE_RELAYER_URL to a full https:// URL (example: https://api.smainer.io).'
      );
      setStep('error');
      return;
    }
    
    // Ready to connect wallet
    if (isConnected && address) {
      registerWalletAndApprove();
    } else {
      setStep('connect');
    }
  }, [chatId, approvalCredential, relayerBaseUrl, isConnected, address, registerWalletAndApprove]);

  // When wallet connects, register it and trigger approve
  useEffect(() => {
    if (isConnected && address && step === 'connect') {
      registerWalletAndApprove();
    }
  }, [isConnected, address, step, registerWalletAndApprove]);

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
    const walletUrl = buildBraavosApproveUrl({ chatId, credential: approvalCredential });
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

            <div className="mb-4 rounded-xl bg-white/5 p-3 text-left text-xs text-white/50">
              <div className="font-medium text-white/60 mb-1">Diagnostics</div>
              <div>chat_id present: {chatId ? 'yes' : 'no'}</div>
              <div>credential present: {approvalCredential ? 'yes' : 'no'}</div>
              <div>
                mode:{' '}
                {credentialMode ? (credentialMode === 'token' ? 'token mode' : 'code mode') : 'unknown'}
              </div>
              <div>credential in path: {routeParams.credential ? 'yes' : 'no'}</div>
              <div>credential in query: {rawCredentialFromQuery?.trim() ? 'yes' : 'no'}</div>
            </div>

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
