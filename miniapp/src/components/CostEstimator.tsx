import React, { useState, useEffect } from 'react';
import type { AIModel } from '@/types';

interface CostEstimatorProps {
  model: AIModel;
  estimatedTokens: number;
  userBalance?: {
    strk: string;
    smainer: string;
  };
}

export function CostEstimator({ model, estimatedTokens, userBalance }: CostEstimatorProps) {
  const [estimatedCost, setEstimatedCost] = useState({
    totalCost: 0,
    platformFee: 0,
    providerPayout: 0,
    strkCost: 0,
    smainerCost: 0,
  });

  const [paymentMethod, setPaymentMethod] = useState<'STRK' | 'SMAINER'>('STRK');

  useEffect(() => {
    // Calculate costs
    const totalCost = estimatedTokens * model.cost_per_token;
    const platformFee = totalCost * 0.12; // 12% platform fee
    const providerPayout = totalCost * 0.88; // 88% to provider

    // Mock exchange rates (in production, fetch from API)
    const strkRate = 0.5; // $0.50 per STRK
    const smainerRate = 0.1; // $0.10 per SMAINER

    const strkCost = totalCost / strkRate;
    const smainerCost = totalCost / smainerRate;

    setEstimatedCost({
      totalCost,
      platformFee,
      providerPayout,
      strkCost,
      smainerCost,
    });
  }, [estimatedTokens, model.cost_per_token]);

  const selectedCost = paymentMethod === 'STRK' ? estimatedCost.strkCost : estimatedCost.smainerCost;
  const selectedBalance = userBalance ? (paymentMethod === 'STRK' ? userBalance.strk : userBalance.smainer) : '0';
  const hasEnoughBalance = parseFloat(selectedBalance) >= selectedCost;

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Cost Estimate</h4>
        <div className="text-xs text-muted-foreground">
          ~{estimatedTokens} tokens
        </div>
      </div>

      {/* Payment Method Selection */}
      <div className="flex space-x-2">
        <PaymentMethodButton
          method="STRK"
          isSelected={paymentMethod === 'STRK'}
          cost={estimatedCost.strkCost}
          symbol="STRK"
          onClick={() => setPaymentMethod('STRK')}
        />
        <PaymentMethodButton
          method="SMAINER"
          isSelected={paymentMethod === 'SMAINER'}
          cost={estimatedCost.smainerCost}
          symbol="SMAINER"
          onClick={() => setPaymentMethod('SMAINER')}
        />
      </div>

      {/* Balance Check */}
      {userBalance && (
        <div className={`flex items-center justify-between text-sm ${
          hasEnoughBalance ? 'text-green-600' : 'text-red-600'
        }`}>
          <span>Your Balance:</span>
          <span className="font-medium">
            {parseFloat(selectedBalance).toFixed(4)} {paymentMethod}
          </span>
        </div>
      )}

      {/* Cost Breakdown */}
      <div className="space-y-2 pt-2 border-t border-border/50">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Provider Fee:</span>
          <span>{estimatedCost.providerPayout.toFixed(4)} USD</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Platform Fee (12%):</span>
          <span>{estimatedCost.platformFee.toFixed(4)} USD</span>
        </div>
        <div className="flex justify-between text-sm font-medium border-t border-border/50 pt-2">
          <span>Total:</span>
          <span className="text-success">
            {selectedCost.toFixed(4)} {paymentMethod}
          </span>
        </div>
      </div>

      {/* Warnings */}
      {!hasEnoughBalance && userBalance && (
        <div className="flex items-start space-x-2 p-2 bg-red-50 border border-red-200 rounded text-red-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <div className="font-medium text-xs">Insufficient Balance</div>
            <div className="text-xs">
              You need {(selectedCost - parseFloat(selectedBalance)).toFixed(4)} more {paymentMethod}
            </div>
          </div>
        </div>
      )}

      {estimatedTokens === 0 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Start typing to see cost estimate
        </div>
      )}
    </div>
  );
}

interface PaymentMethodButtonProps {
  method: 'STRK' | 'SMAINER';
  isSelected: boolean;
  cost: number;
  symbol: string;
  onClick: () => void;
}

function PaymentMethodButton({ method, isSelected, cost, symbol, onClick }: PaymentMethodButtonProps) {
  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'STRK':
        return 'STRK';
      case 'SMAINER':
        return 'SMR';
      default:
        return 'TOK';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`flex-1 p-2 rounded-md border transition-colors ${
        isSelected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      <div className="flex items-center justify-center space-x-2">
        <span className="text-xs font-mono">{getMethodIcon(method)}</span>
        <div className="text-left">
          <div className="font-medium text-xs">{symbol}</div>
          <div className="text-xs opacity-75">
            {cost.toFixed(4)}
          </div>
        </div>
      </div>
    </button>
  );
}