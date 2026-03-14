/* Starknet configuration and contract addresses */


import { StarknetConfig, publicProvider } from '@starknet-react/core';

// Contract addresses (update with actual deployments)
export const CONTRACT_ADDRESSES = {
  SMAINER_TOKEN: import.meta.env.VITE_SMAINER_TOKEN_ADDRESS || '0x0',
  NFT_FACTORY: import.meta.env.VITE_NFT_FACTORY_ADDRESS || '0x0',  
  USER_PROFILE: import.meta.env.VITE_USER_PROFILE_ADDRESS || '0x0',
  DATA_STORAGE: import.meta.env.VITE_DATA_STORAGE_ADDRESS || '0x0',
  ESCROW: import.meta.env.VITE_SMAINER_CONTRACT_ADDRESS || '0x0',
} as const;

// Starknet chain configuration
import { mainnet, sepolia } from '@starknet-react/chains';

export const chains = [mainnet, sepolia];

// Starknet React configuration  
export const starknetConfig = {
  chains,
  provider: publicProvider(),
};

// Token decimals
export const TOKEN_DECIMALS = {
  STRK: 18,
  SMAINER: 18,
  ETH: 18,
} as const;

// Contract ABIs (simplified - full ABIs should be imported from JSON files)
export const SMAINER_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balance_of',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'U256' }],
    state_mutability: 'view',
  },
  {
    type: 'function', 
    name: 'transfer',
    inputs: [
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'U256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'felt' },
      { name: 'amount', type: 'U256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    state_mutability: 'external',
  },
] as const;

export const NFT_FACTORY_ABI = [
  {
    type: 'function',
    name: 'mint_nft',
    inputs: [
      { name: 'to', type: 'felt' },
      { name: 'metadata_uri', type: 'felt' },
      { name: 'royalty_recipient', type: 'felt' },
      { name: 'royalty_percentage', type: 'felt' },
    ],
    outputs: [{ name: 'token_id', type: 'U256' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'get_user_nfts',
    inputs: [{ name: 'user', type: 'felt' }],
    outputs: [{ name: 'token_ids', type: 'felt*' }],
    state_mutability: 'view',
  },
] as const;

// Utility functions
export function formatTokenAmount(amount: string | number, decimals: number = 18): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return (num / Math.pow(10, decimals)).toFixed(4);
}

export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
  const num = parseFloat(amount);
  return BigInt(Math.floor(num * Math.pow(10, decimals)));
}

export function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isValidStarknetAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(address);
}