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
 * Strategy for users who have linked a wallet via the Telegram bot but are
 * accessing the MiniApp in read-only mode (no signing account available).
 *
 * Posts a payment-request to the bot API so the bot can prompt the user to
 * sign from their linked wallet through a separate flow.
 */
export class BotLinkedStrategy extends AbstractPaymentStrategy {
  constructor(onProgress: ProgressCallback) {
    super(onProgress);
  }

  getCapabilities(): StrategyCapabilities {
    return {
      canSign: false,
      requiresRedirect: false,
      ctaLabel: 'Request Payment via Bot',
    };
  }

  async execute(ctx: PaymentContext): Promise<PaymentResult> {
    this.onProgress({ phase: 'notifying-bot' });

    try {
      const response = await fetch(`${ctx.botApiUrl}/api/payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: ctx.prompt,
          tier: ctx.tier,
          escrow_amount_wei: ctx.escrowAmountWei.toString(),
          chat_id: ctx.chatId,
          message_id: ctx.messageId,
          starknet_address: ctx.effectiveAddress,
          init_data: ctx.initDataRaw,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(`Bot payment-request failed: ${text}`);
      }

      this.onProgress({ phase: 'done' });
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.onProgress({ phase: 'error', errorMessage });
      return { success: false, errorMessage };
    }
  }
}
