import type { AccountInterface } from 'starknet';
import type { PaymentEnvironment } from './types';
import type { ProgressCallback } from './strategies/AbstractPaymentStrategy';
import { AbstractPaymentStrategy } from './strategies/AbstractPaymentStrategy';
import { StarknetWalletStrategy } from './strategies/StarknetWalletStrategy';
import { TelegramWebViewStrategy } from './strategies/TelegramWebViewStrategy';
import { BotLinkedStrategy } from './strategies/BotLinkedStrategy';

// -------------------------------------------------------------------------
// Environment resolution input
// -------------------------------------------------------------------------

export interface ResolveEnvironmentInput {
  /** True when running inside a Telegram WebView (extensions unavailable) */
  isTelegramWebView: boolean;
  /** Signing account from starknet-react — undefined if wallet not connected */
  account: AccountInterface | undefined;
  /** Address of a wallet linked through the Telegram bot (read-only) */
  botLinkedWallet: string | null;
}

/**
 * Determine which payment environment applies given the current runtime
 * context. Pure function — no side effects.
 */
export function resolveEnvironment(input: ResolveEnvironmentInput): PaymentEnvironment {
  // Real browser with a connected signing wallet → full on-chain flow.
  // Must check BEFORE telegram-webview because starknet-react may cache
  // an account in TG WebView that can't actually sign.
  if (!input.isTelegramWebView && input.account) return 'starknet-wallet';

  // Bot-linked wallet works everywhere — no browser extension needed.
  // Posts a payment-request to the bot API; check BEFORE telegram-webview
  // so users who already linked via /link skip the wallet chooser screen.
  if (input.botLinkedWallet) return 'bot-linked-readonly';

  // Telegram WebView without bot-linked wallet — must redirect to browser
  // for wallet extension signing.
  if (input.isTelegramWebView) return 'telegram-webview';

  // Standalone browser, no wallet connected yet.
  // Do NOT fall back to 'telegram-webview' here — that sets
  // requiresRedirect=true which shows wallet-choice redirect buttons.
  // On desktop, those buttons open the same URL → infinite loop.
  // 'bot-linked-readonly' has requiresRedirect=false so the user sees
  // the standard connect UI and can install/connect a wallet extension.
  return 'bot-linked-readonly';
}

// -------------------------------------------------------------------------
// Strategy factory input
// -------------------------------------------------------------------------

export interface CreateStrategyInput extends ResolveEnvironmentInput {
  /** Async fn that returns the current STRK allowance as a bigint */
  checkAllowance: () => Promise<bigint>;
  /** Progress callback passed down to the instantiated strategy */
  onProgress: ProgressCallback;
}

/**
 * Instantiate the correct concrete strategy for the current environment.
 */
export function createPaymentStrategy(input: CreateStrategyInput): AbstractPaymentStrategy {
  const env = resolveEnvironment(input);

  switch (env) {
    case 'starknet-wallet':
      return new StarknetWalletStrategy(
        input.account!,
        input.checkAllowance,
        input.onProgress,
      );
    case 'bot-linked-readonly':
      return new BotLinkedStrategy(input.onProgress);
    case 'telegram-webview':
    default:
      return new TelegramWebViewStrategy(input.onProgress);
  }
}
