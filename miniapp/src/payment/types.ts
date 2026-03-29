import type { ComputeTier } from '@/lib/starknet';

export type PaymentEnvironment = 'starknet-wallet' | 'telegram-webview' | 'bot-linked-readonly';

export type PaymentPhase =
  | 'idle'
  | 'checking-allowance'
  | 'awaiting-wallet-approval'
  | 'broadcasting'
  | 'confirming'
  | 'notifying-bot'
  | 'done'
  | 'error';

export interface PaymentContext {
  prompt: string;
  tier: ComputeTier;
  escrowAmountWei: bigint;
  effectiveAddress: string | undefined;
  chatId: string | null;
  messageId: string | null;
  initDataRaw: string | undefined;
  botApiUrl: string;
}

export interface PaymentProgress {
  phase: PaymentPhase;
  txHash?: string;
  taskId?: string;
  errorMessage?: string;
}

export interface PaymentResult {
  success: boolean;
  taskId?: string;
  txHash?: string;
  errorMessage?: string;
}

export interface StrategyCapabilities {
  canSign: boolean;
  requiresRedirect: boolean;
  ctaLabel: string;
}

export interface BotNotificationPayload {
  action: 'payment_complete';
  on_chain_task_id: string;
  prompt: string;
  tier: ComputeTier;
  chat_id: string | null;
  message_id: string | null;
  starknet_address: string | undefined;
  init_data?: string;
}
