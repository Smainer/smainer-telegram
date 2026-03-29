import {
  AbstractPaymentStrategy,
  type ProgressCallback,
} from './AbstractPaymentStrategy';
import type {
  PaymentContext,
  PaymentResult,
  StrategyCapabilities,
} from '../types';

/**
 * Strategy for the Telegram WebView environment where browser extensions are
 * unavailable. Opens the MiniApp URL in an external browser so the user can
 * connect Argent X or Braavos.
 *
 * Returns `{ success: false, errorMessage: 'REDIRECT_INITIATED' }` — the
 * caller treats this as a non-fatal redirect, not an actual failure.
 */
export class TelegramWebViewStrategy extends AbstractPaymentStrategy {
  constructor(onProgress: ProgressCallback) {
    super(onProgress);
  }

  getCapabilities(): StrategyCapabilities {
    return {
      canSign: false,
      requiresRedirect: true,
      ctaLabel: 'Open in Browser to Pay',
    };
  }

  async execute(ctx: PaymentContext): Promise<PaymentResult> {
    const payUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;

    try {
      (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch {
      // HapticFeedback is not always available — ignore gracefully
    }

    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(payUrl);
    } else {
      window.open(payUrl, '_blank');
    }

    // Signal that a redirect was initiated (not an error, not a success).
    return { success: false, errorMessage: 'REDIRECT_INITIATED' };
  }
}
