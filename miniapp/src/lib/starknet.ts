/* Starknet configuration and contract addresses */


import { argent, braavos, jsonRpcProvider } from '@starknet-react/core';

function parseContractAddress(envKey: string, required: boolean): string | undefined {
  const raw = import.meta.env[envKey] as string | undefined;

  if (!raw || raw === '0x0') {
    if (required) {
      throw new Error(`Missing required Starknet address: ${envKey}`);
    }
    return undefined;
  }

  if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) {
    throw new Error(`Invalid Starknet address format for ${envKey}`);
  }

  return raw;
}

// Contract addresses (update with actual deployments)
export const CONTRACT_ADDRESSES = {
  SMAINER_TOKEN: parseContractAddress('VITE_SMAINER_TOKEN_ADDRESS', false),
  NFT_FACTORY: parseContractAddress('VITE_NFT_FACTORY_ADDRESS', false),  
  USER_PROFILE: parseContractAddress('VITE_USER_PROFILE_ADDRESS', false),
  DATA_STORAGE: parseContractAddress('VITE_DATA_STORAGE_ADDRESS', false),
  ESCROW: parseContractAddress('VITE_SMAINER_CONTRACT_ADDRESS', false),
  // Main compute contract
  SMAINER_COMPUTE: '0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe',
  // STRK token address on mainnet
  STRK_TOKEN: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
} as const;

// Starknet chain configuration
import { mainnet, sepolia } from '@starknet-react/chains';

export const chains = [mainnet, sepolia];

const fallbackRpcUrl = 'https://api.cartridge.gg/x/starknet/mainnet';
const configuredRpcUrl = (import.meta.env.VITE_STARKNET_RPC_URL as string | undefined) || fallbackRpcUrl;

// Starknet React configuration  
export const starknetConfig = {
  chains,
  provider: jsonRpcProvider({
    rpc: (chain) => ({
      nodeUrl: chain.network === 'sepolia'
        ? 'https://api.cartridge.gg/x/starknet/sepolia'
        : configuredRpcUrl,
    }),
  }),
  connectors: [argent(), braavos()],
};

// Token decimals
export const TOKEN_DECIMALS = {
  STRK: 18,
  SMAINER: 18,
  ETH: 18,
} as const;

// Contract ABIs (simplified - full ABIs should be imported from JSON files)
// NOTE: Using felt252 for addresses and Uint256 for u256 - starknet.js v5 compatible types
export const SMAINER_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balance_of',
    inputs: [{ name: 'account', type: 'felt252' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    state_mutability: 'view',
  },
  {
    type: 'function', 
    name: 'transfer',
    inputs: [
      { name: 'recipient', type: 'felt252' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt252' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'felt252' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt252' }],
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

// Smainer Compute Contract ABI (starknet.js v5 compatible types)
export const SMAINER_COMPUTE_ABI = [
  {
    type: 'function',
    name: 'create_task',
    inputs: [
      { name: 'token_address', type: 'felt252' },
      { name: 'amount', type: 'Uint256' },
      { name: 'task_hash', type: 'felt252' },
    ],
    outputs: [{ name: 'task_id', type: 'Uint256' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'create_tiered_task',
    inputs: [
      { name: 'token_address', type: 'felt252' },
      { name: 'base_amount', type: 'Uint256' },
      { name: 'required_tier', type: 'felt252' },
      { name: 'task_hash', type: 'felt252' },
    ],
    outputs: [{ name: 'task_id', type: 'Uint256' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'get_tier_multiplier',
    inputs: [{ name: 'tier', type: 'felt252' }],
    outputs: [{ name: 'multiplier', type: 'Uint256' }],
    state_mutability: 'view',
  },
] as const;

// ERC20/STRK Token ABI (starknet.js v5 compatible types)
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balance_of',
    inputs: [{ name: 'account', type: 'felt252' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    state_mutability: 'view',
  },
  {
    type: 'function', 
    name: 'transfer',
    inputs: [
      { name: 'recipient', type: 'felt252' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt252' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'felt252' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt252' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'felt252' },
      { name: 'spender', type: 'felt252' },
    ],
    outputs: [{ name: 'remaining', type: 'Uint256' }],
    state_mutability: 'view',
  },
] as const;

// Utility functions
export function formatTokenAmount(amount: string | number | bigint, decimals: number = 18): string {
  // Convert to bigint for precise handling
  let amountBigInt: bigint;
  if (typeof amount === 'bigint') {
    amountBigInt = amount;
  } else if (typeof amount === 'string') {
    // Handle decimal strings and integer strings
    if (amount.includes('.')) {
      // It's already a formatted decimal, just pass through
      return parseFloat(amount).toFixed(4);
    }
    amountBigInt = BigInt(amount);
  } else {
    amountBigInt = BigInt(Math.floor(amount));
  }
  
  // Divide by 10^decimals using bigint arithmetic
  const divisor = BigInt(10 ** decimals);
  const integerPart = amountBigInt / divisor;
  const remainder = amountBigInt % divisor;
  
  // Calculate decimal places (up to 4 digits)
  const decimalPart = (remainder * BigInt(10000)) / divisor;
  const decimalStr = decimalPart.toString().padStart(4, '0');
  
  return `${integerPart}.${decimalStr}`;
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

// Tier configuration
export const COMPUTE_TIERS = {
  BASIC: { id: 1, name: 'Basic', multiplier: 1.0 },
  PRO: { id: 2, name: 'Pro', multiplier: 2.2 },
  PREMIUM: { id: 3, name: 'Premium', multiplier: 3.5 },
} as const;

export type ComputeTier = keyof typeof COMPUTE_TIERS;

// Base prompt cost in STRK (0.1 STRK in wei)
export const BASE_PROMPT_COST = BigInt('100000000000000000'); // 0.1 * 10^18

export function getPromptCost(tier: ComputeTier): bigint {
  const multiplier = COMPUTE_TIERS[tier].multiplier;
  return BigInt(Math.floor(Number(BASE_PROMPT_COST) * multiplier));
}

// Model complexity factors for cost estimation
export const MODEL_COMPLEXITY: Record<string, number> = {
  'llama3.1:8b': 0.2, 'mistral:7b': 0.2, 'gemma2:9b': 0.2,
  'llama3.1:13b': 0.4, 'codellama:13b': 0.4,
  'codellama:34b': 0.6, 'yi:34b': 0.6,
  'llama3.1:70b': 0.8, 'mixtral:8x7b': 0.8,
  'llama3.1:405b': 1.0,
};

export function getModelComplexity(modelId: string): number {
  if (MODEL_COMPLEXITY[modelId]) return MODEL_COMPLEXITY[modelId];
  const match = modelId.match(/(\d+)b/i);
  if (match) {
    const params = parseInt(match[1]);
    if (params >= 100) return 1.0;
    if (params >= 34) return 0.6;
    if (params >= 13) return 0.4;
  }
  return 0.2;
}

export function estimateTokenCount(text: string): number {
  const CHARS_PER_TOKEN = 3.5;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export const MAX_EFFORT_MULTIPLIER = 7.5;
export const SAFETY_MARGIN = 1.3;

// Prompt hashing for on-chain verification
export async function hashPrompt(prompt: string): Promise<string> {
  // Use Web Crypto API to hash the prompt
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Convert to hex string
  const hashHex = Array.from(hashArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  
  // Convert to felt252 by taking modulo field prime
  // Starknet field prime: 2^251 + 17 * 2^192 + 1
  const FIELD_PRIME = BigInt('0x800000000000011000000000000000000000000000000000000000000000001');
  const hashBigint = BigInt('0x' + hashHex);
  const felt252 = hashBigint % FIELD_PRIME;
  
  return '0x' + felt252.toString(16);
}