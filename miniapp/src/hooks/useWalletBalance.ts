/**
 * useWalletBalance - Fetches STRK balance for a connected wallet
 * 
 * Uses raw RPC calls to bypass starknet-react contract wrapper ABI issues.
 * Automatically refetches when the wallet address changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from '@starknet-react/core';
import { RpcProvider } from 'starknet';
import { CONTRACT_ADDRESSES, TOKEN_DECIMALS, formatTokenAmount } from '@/lib/starknet';

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

  const fetchBalance = useCallback(async () => {
    if (!address || !isConnected) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Normalize address to 64 hex chars (matching bot's format)
      const hexPart = address.toLowerCase().replace(/^0x/, '');
      const normalizedAddress = '0x' + hexPart.padStart(64, '0');
      
      // Use raw RPC to bypass starknet-react ABI type validation issues
      const provider = new RpcProvider({ 
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet' 
      });
      
      const result = await provider.callContract({
        contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
        entrypoint: 'balance_of',
        calldata: [normalizedAddress],
      });
      
      // Result is array [low_felt, high_felt] for u256
      const resultArray = result as unknown as string[];
      const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
      const low = BigInt(resultArray[0]);
      const high = resultArray[1] ? BigInt(resultArray[1]) : BigInt(0);
      const balanceWei = high * U128_MAX_PLUS_ONE + low;
      
      const formattedBalance = formatTokenAmount(balanceWei, TOKEN_DECIMALS.STRK);
      setBalance(formattedBalance);
    } catch (err) {
      console.error('Failed to fetch STRK balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
      // Keep previous balance on error
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected]);

  // Fetch balance when wallet connects or address changes
  useEffect(() => {
    if (isConnected && address) {
      fetchBalance();
    }
  }, [isConnected, address, fetchBalance]);

  return {
    balance,
    isLoading,
    error,
    refetch: fetchBalance,
  };
}
