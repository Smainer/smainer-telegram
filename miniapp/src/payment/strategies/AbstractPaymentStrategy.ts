import type {
  PaymentContext,
  PaymentProgress,
  PaymentResult,
  StrategyCapabilities,
  BotNotificationPayload,
} from '../types';

export type ProgressCallback = (progress: PaymentProgress) => void;

/**
 * Abstract base class for all payment strategies.
 * Concrete subclasses implement `execute()` and `getCapabilities()`.
 * `notifyBot()` is a shared concrete helper used by all strategies.
 */
export abstract class AbstractPaymentStrategy {
  protected onProgress: ProgressCallback;

  constructor(onProgress: ProgressCallback) {
    this.onProgress = onProgress;
  }

  /**
   * Execute the full payment flow for this strategy.
   * Must emit progress updates via `this.onProgress()` throughout.
   */
  abstract execute(ctx: PaymentContext): Promise<PaymentResult>;

  /**
   * Describe what this strategy is capable of so the UI can adapt.
   */
  abstract getCapabilities(): StrategyCapabilities;

  /**
   * Notify the bot after a successful on-chain task creation.
   * Prefers Telegram.WebApp.sendData (closes mini-app automatically).
   * Falls back to HTTP POST when running in a standalone browser.
   */
  protected async notifyBot(
    ctx: PaymentContext,
    taskId: string,
    txHash: string,
  ): Promise<void> {
    this.onProgress({ phase: 'notifying-bot', txHash, taskId });

    const payload: BotNotificationPayload = {
      action: 'payment_complete',
      on_chain_task_id: taskId,
      prompt: ctx.prompt,
      tier: ctx.tier,
      chat_id: ctx.chatId,
      message_id: ctx.messageId,
      starknet_address: ctx.effectiveAddress,
    };

    const tg = (window as any).Telegram?.WebApp;

    if (tg?.sendData) {
      // Inside Telegram WebView — sendData() delivers the payload to the bot
      // and closes the mini-app automatically.
      tg.sendData(JSON.stringify(payload));
    } else {
      // Standalone browser — use HTTP POST fallback.
      try {
        await fetch(`${ctx.botApiUrl}/api/payment-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            init_data: ctx.initDataRaw,
          }),
        });
      } catch (err) {
        // Bot notification failure is non-fatal; the task is already on-chain.
        console.warn('[AbstractPaymentStrategy] payment-complete POST failed:', err);
      }
    }
  }
}
