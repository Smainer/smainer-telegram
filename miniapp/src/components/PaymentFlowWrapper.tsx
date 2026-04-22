import React from 'react';
import { PaymentFlow } from './PaymentFlow';
import { AnimatedLogo } from './AnimatedLogo';
import { ComputeTier } from '@/lib/starknet';

export interface PaymentFlowParams {
  prompt: string;
  tier: ComputeTier;
  chatId: string;
  messageId: string;
  nonce?: string;
}

interface PaymentFlowWrapperProps {
  params: PaymentFlowParams;
}

/**
 * Payment flow wrapper for bot-initiated payments
 */
export function PaymentFlowWrapper({ params }: PaymentFlowWrapperProps) {
  const handleSuccess = (taskId: string) => {
    // sendData() in PaymentFlow already closes the MiniApp and sends data to bot
    // This callback is for any additional cleanup if needed
    console.log('Payment flow completed, task:', taskId);
  };

  const handleCancel = () => {
    // Close the MiniApp when user cancels
    try {
      (window as any).Telegram?.WebApp?.close();
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