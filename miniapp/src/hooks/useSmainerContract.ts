import { useCallback } from 'react';
import { useAccount, useContract } from '@starknet-react/core';
import { RpcProvider } from 'starknet';
import {
  CONTRACT_ADDRESSES,
  SMAINER_COMPUTE_ABI,
  ERC20_ABI,
  ComputeTier,
  getPromptCost,
  formatTokenAmount,
  TOKEN_DECIMALS
} from '@/lib/starknet';

export function useSmainerContract() {
  const { address } = useAccount();

  // Contract instances (kept for ABI-level calls like task_count fallback)
  const { contract: smainerContract } = useContract({
    address: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
    abi: SMAINER_COMPUTE_ABI,
  });

  const { contract: strkContract } = useContract({
    address: CONTRACT_ADDRESSES.STRK_TOKEN,
    abi: ERC20_ABI,
  });

  // Check current STRK allowance for the compute contract (raw RPC to bypass ABI wrapper issues)
  const checkAllowance = useCallback(async (): Promise<bigint> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const hexPart = address.toLowerCase().replace(/^0x/, '');
      const normalizedOwner = '0x' + hexPart.padStart(64, '0');
      const spenderHex = CONTRACT_ADDRESSES.SMAINER_COMPUTE.toLowerCase().replace(/^0x/, '');
      const normalizedSpender = '0x' + spenderHex.padStart(64, '0');

      const provider = new RpcProvider({
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet'
      });

      const result = await provider.callContract({
        contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
        entrypoint: 'allowance',
        calldata: [normalizedOwner, normalizedSpender],
      }, 'latest');

      const rawResult = (result as any).result ?? result;
      const resultArray = rawResult as string[];
      const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
      const low = BigInt(resultArray[0]);
      const high = resultArray[1] ? BigInt(resultArray[1]) : BigInt(0);
      return high * U128_MAX_PLUS_ONE + low;
    } catch (error) {
      console.error('Failed to check allowance:', error);
      throw new Error('Failed to check allowance');
    }
  }, [address]);

  // Check STRK balance using raw RPC (bypasses starknet-react contract wrapper issues)
  const checkBalance = useCallback(async (targetAddress?: string): Promise<string> => {
    const addr = targetAddress || address;
    if (!addr) {
      console.log('[checkBalance] Not ready - no address');
      throw new Error('Wallet not connected');
    }

    try {
      // Normalize address to 64 hex chars (matching bot's format)
      const hexPart = addr.toLowerCase().replace(/^0x/, '');
      const normalizedAddress = '0x' + hexPart.padStart(64, '0');

      console.log('[checkBalance] Using raw RPC for address:', normalizedAddress);
      console.log('[checkBalance] STRK contract address:', CONTRACT_ADDRESSES.STRK_TOKEN);

      const provider = new RpcProvider({
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet'
      });

      const result = await provider.callContract({
        contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
        entrypoint: 'balance_of',
        calldata: [normalizedAddress],
      }, 'latest');

      console.log('[checkBalance] Raw RPC result:', result);

      const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
      const rawResult = (result as any).result ?? result;
      const resultArray = rawResult as string[];
      const low = BigInt(resultArray[0]);
      const high = resultArray[1] ? BigInt(resultArray[1]) : BigInt(0);
      const balance = high * U128_MAX_PLUS_ONE + low;

      console.log('[checkBalance] Parsed u256:', {
        low: low.toString(),
        high: high.toString(),
        balance: balance.toString()
      });

      const formatted = formatTokenAmount(balance, TOKEN_DECIMALS.STRK);
      console.log('[checkBalance] Final:', formatted, 'STRK');
      return formatted;
    } catch (error) {
      console.error('[checkBalance] Failed:', error);
      throw new Error(`Failed to check balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [address]);

  // Get prompt cost for a specific tier
  const getPromptCostForTier = useCallback((tier: ComputeTier): string => {
    const costWei = getPromptCost(tier);
    return formatTokenAmount(costWei.toString(), TOKEN_DECIMALS.STRK);
  }, []);

  return {
    checkAllowance,
    checkBalance,
    getPromptCostForTier,

    // Contract availability
    isContractReady: !!(smainerContract && strkContract),
  };
}
