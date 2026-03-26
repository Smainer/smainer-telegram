import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect } from '@starknet-react/core';
import { useSmainerContract } from '@/hooks/useSmainerContract';
import { ComputeTier, COMPUTE_TIERS } from '@/lib/starknet';

interface PaymentFlowProps {
  prompt: string;
  tier?: ComputeTier;
  onSuccess: (taskId: string) => void;
  onCancel: () => void;
}

type PaymentStep = 'connect' | 'confirm' | 'processing' | 'success' | 'error';

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

  // Read URL parameters for Telegram integration
  const searchParams = new URLSearchParams(window.location.search);
  const chatId = searchParams.get('chat_id');
  const messageId = searchParams.get('message_id');

  // Wallet connection hooks
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

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
    isLoading,
    error,
    isContractReady,
    resetTxState
  } = useSmainerContract();

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
    if (isContractReady && isConnected) {
      checkBalance()
        .then(setBalance)
        .catch((e) => {
          console.error('Failed to check balance:', e);
          setInitError('Failed to load wallet balance');
        });
    }
  }, [isContractReady, isConnected, checkBalance]);

  // Handle wallet connection
  const handleConnect = async (connector: any) => {
    if (connectingId) return;
    try {
      setConnectingId(connector.id);
      await connect({ connector });
      // Step will update via useEffect when isConnected changes
    } catch (e) {
      console.error('Wallet connection failed:', e);
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
      const result = await createTask(prompt, tier);
      
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
          });
          window.Telegram?.WebApp?.sendData(webAppData);
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="glass w-full max-w-md p-6 animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-white">
            {step === 'connect' && 'Connect Wallet'}
            {step === 'confirm' && 'Confirm Payment'}
            {step === 'processing' && 'Processing Payment'}
            {step === 'success' && 'Payment Successful'}
            {step === 'error' && 'Payment Failed'}
          </h3>
          
          {(step === 'connect' || step === 'confirm' || step === 'error') && (
            <button
              onClick={onCancel}
              className="text-[var(--text-muted)] hover:text-white transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6L6 18M6 6L18 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Connect Wallet Step */}
        {step === 'connect' && (
          <div className="space-y-6">
            {/* Prompt Preview */}
            <div className="p-3 rounded-lg bg-[var(--void)] border border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-muted)] mb-1">Prompt:</p>
              <p className="text-white text-sm line-clamp-2">{prompt}</p>
            </div>

            {/* Cost Info */}
            <div className="flex justify-between items-center p-3 rounded-lg bg-[var(--void)]">
              <span className="text-[var(--text-muted)]">Cost:</span>
              <span className="text-white font-semibold">{promptCost} STRK</span>
            </div>

            {/* Instructions */}
            <p className="text-[var(--text-muted)] text-sm text-center">
              Connect your Starknet wallet to approve the payment
            </p>

            {/* Init Error */}
            {initError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {initError}
              </div>
            )}

            {/* Wallet Connectors */}
            <div className="space-y-3">
              {availableConnectors.length > 0 ? (
                availableConnectors.map((connector) => (
                  <button
                    key={connector.id}
                    onClick={() => handleConnect(connector)}
                    disabled={connectingId !== null}
                    className="w-full px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-white hover:border-[var(--blue)] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {connectingId === connector.id ? (
                      <span className="animate-pulse">Connecting...</span>
                    ) : (
                      <>
                        <span className="capitalize">{connector.id}</span>
                      </>
                    )}
                  </button>
                ))
              ) : (
                <div className="text-center space-y-3">
                  <p className="text-[var(--text-muted)] text-sm">
                    No wallet detected. Install Argent X or Braavos.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <a
                      href="https://www.argent.xyz/argent-x/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-lg bg-[var(--blue)] text-white text-sm hover:opacity-90"
                    >
                      Argent X
                    </a>
                    <a
                      href="https://braavos.app/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-lg bg-[var(--green)] text-black text-sm hover:opacity-90"
                    >
                      Braavos
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Cancel Button */}
            <button
              onClick={onCancel}
              className="w-full px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:border-white transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Confirmation Step */}
        {step === 'confirm' && (
          <div className="space-y-6">
            {/* Cost Breakdown */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)]">Tier:</span>
                <span className="text-white font-medium">
                  {tierInfo.name} (×{tierInfo.multiplier})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)]">Cost:</span>
                <span className="text-white font-semibold text-lg">
                  {promptCost} STRK
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)]">Your Balance:</span>
                <span className={`font-medium ${hasInsufficientBalance ? 'text-red-400' : 'text-[var(--green)]'}`}>
                  {balance} STRK
                </span>
              </div>
            </div>

            {/* Prompt Preview */}
            <div className="p-3 rounded-lg bg-[var(--void)] border border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-muted)] mb-1">Prompt:</p>
              <p className="text-white text-sm line-clamp-3">
                {prompt}
              </p>
            </div>

            {/* Insufficient Balance Warning */}
            {hasInsufficientBalance && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
                    <line x1="15" y1="9" x2="9" y2="15" stroke="#ef4444" strokeWidth="2"/>
                    <line x1="9" y1="9" x2="15" y2="15" stroke="#ef4444" strokeWidth="2"/>
                  </svg>
                  <span className="text-red-400 text-sm font-medium">
                    Insufficient STRK Balance
                  </span>
                </div>
                <p className="text-red-400 text-xs mt-1">
                  You need {promptCost} STRK to process this prompt
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:border-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePayment}
                disabled={hasInsufficientBalance || !isContractReady}
                className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-[var(--green)] to-[var(--blue)] text-black font-medium hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve & Pay
              </button>
            </div>
          </div>
        )}

        {/* Processing Step */}
        {step === 'processing' && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-r from-[var(--green)] to-[var(--blue)] flex items-center justify-center animate-pulse">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
                <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-white mb-2">
                Processing Transaction
              </h4>
              <p className="text-[var(--text-muted)] text-sm">
                Confirming payment and creating compute task...
              </p>
            </div>
          </div>
        )}

        {/* Success Step */}
        {step === 'success' && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-[var(--green)] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 12l2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-white mb-2">
                Payment Confirmed!
              </h4>
              <p className="text-[var(--text-muted)] text-sm">
                Task ID: {taskId.slice(0, 8)}...
              </p>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                Proceeding to compute...
              </p>
            </div>
          </div>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
                  <line x1="15" y1="9" x2="9" y2="15" stroke="#ef4444" strokeWidth="2"/>
                  <line x1="9" y1="9" x2="15" y2="15" stroke="#ef4444" strokeWidth="2"/>
                </svg>
              </div>
              <h4 className="text-lg font-semibold text-white mb-2">
                Payment Failed
              </h4>
              <p className="text-red-400 text-sm">
                {error || 'Transaction was rejected or failed'}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:border-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRetry}
                className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-[var(--green)] to-[var(--blue)] text-black font-medium hover:shadow-lg transition-all duration-200"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}