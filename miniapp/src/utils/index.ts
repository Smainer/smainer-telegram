import { ComputeTier } from '@/lib/starknet';
import type { ConnectedWallet } from '@/types';

export const WALLET_STORAGE_KEY = 'smainer_connected_wallet';

/**
 * Map bot tier names (small/medium/large) to MiniApp ComputeTier (BASIC/PRO/PREMIUM)
 */
export function mapBotTierToComputeTier(botTier: string): ComputeTier {
  const tierMap: Record<string, ComputeTier> = {
    small: 'BASIC',
    medium: 'PRO',
    large: 'PREMIUM',
    // Also handle direct tier names in case they're sent
    basic: 'BASIC',
    pro: 'PRO',
    premium: 'PREMIUM',
  };
  return tierMap[botTier.toLowerCase()] || 'BASIC';
}

/**
 * Load persisted wallet from localStorage with validation
 */
export function loadPersistedWallet(): ConnectedWallet | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ConnectedWallet>;
    const isValidAddress = /^0x[0-9a-fA-F]{1,64}$/.test(parsed.address || '');
    if (!isValidAddress) {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
      return null;
    }

    return {
      address: parsed.address!,
      type: parsed.type || 'manual',
      balance_strk: parsed.balance_strk || '0',
      balance_smainer: parsed.balance_smainer || '0',
    };
  } catch {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    return null;
  }
}

/**
 * Store wallet data in localStorage
 */
export function persistWallet(wallet: ConnectedWallet): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
  }
}

/**
 * Remove wallet data from localStorage
 */
export function clearPersistedWallet(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}