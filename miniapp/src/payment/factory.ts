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
  // A connected signing account always wins regardless of WebView status —
  // the user opened a real browser and connected a wallet.
  if (input.account) return 'starknet-wallet';

  // Inside Telegram WebView without a signing account → redirect to browser.
  if (input.isTelegramWebView) return 'telegram-webview';

  // Bot-linked wallet in a standalone browser (no extension connected yet).
  if (input.botLinkedWallet) return 'bot-linked-readonly';

  // Fallback: treat as WebView (show "Open in Browser" CTA).
  return 'telegram-webview';
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
