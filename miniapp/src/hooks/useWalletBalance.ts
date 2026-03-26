/**
 * useWalletBalance - Fetches STRK balance for a connected wallet
 * 
 * This hook uses starknet-react's useContract to call balanceOf on the STRK token.
 * It automatically refetches when the wallet address changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useContract } from '@starknet-react/core';
import { CONTRACT_ADDRESSES, ERC20_ABI, TOKEN_DECIMALS, formatTokenAmount } from '@/lib/starknet';

interface UseWalletBalanceResult {
  balance: string;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWalletBalance(): UseWalletBalanceResult {
  const { address, isConnected } = useAccount();
  const [balance, setBalance] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { contract: strkContract } = useContract({
    address: CONTRACT_ADDRESSES.STRK_TOKEN,
    abi: ERC20_ABI,
  });

  const fetchBalance = useCallback(async () => {
    if (!address || !strkContract || !isConnected) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await strkContract.call('balance_of', [address]);
      const balanceWei = result as bigint;
      const formattedBalance = formatTokenAmount(balanceWei.toString(), TOKEN_DECIMALS.STRK);
      setBalance(formattedBalance);
    } catch (err) {
      console.error('Failed to fetch STRK balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
      // Keep previous balance on error
    } finally {
      setIsLoading(false);
    }
  }, [address, strkContract, isConnected]);

  // Fetch balance when wallet connects or address changes
  useEffect(() => {
    if (isConnected && address && strkContract) {
      fetchBalance();
    }
  }, [isConnected, address, strkContract, fetchBalance]);

  return {
    balance,
    isLoading,
    error,
    refetch: fetchBalance,
  };
}
