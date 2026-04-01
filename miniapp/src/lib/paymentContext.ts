/**
 * Persist payment context across wallet-redirect chains.
 *
 * Before the MiniApp opens a wallet deep link (Braavos / Argent), it stores
 * the current payment parameters in localStorage. When the wallet's in-app
 * browser loads `/pay-resume`, it reads them back so the PaymentFlow can
 * resume where it left off.
 */

const STORAGE_KEY = 'smainer_pending_payment';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface PendingPayment {
  prompt: string;
  tier: string;        // bot tier string: 'small' | 'medium' | 'large'
  chatId: string;
  messageId: string;
  model?: string;
  nonce?: string;       // Bot-issued payment nonce for standalone browser auth
  initDataRaw?: string; // Telegram WebApp initData — needed for HTTP POST fallback auth
  storedAt: number;     // Date.now() at time of storage
}

/**
 * Save payment context to localStorage before redirecting to wallet app.
 * Automatically stamps `storedAt` with the current time.
 */
export function storePaymentContext(
  ctx: Omit<PendingPayment, 'storedAt'>,
): void {
  try {
    const entry: PendingPayment = { ...ctx, storedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (e.g. private browsing) — best-effort only.
    console.warn('[paymentContext] Failed to store payment context');
  }
}

/**
 * Load stored payment context.  Returns `null` when:
 *  - nothing stored
 *  - stored entry has expired (older than TTL_MS)
 *  - JSON is malformed
 */
export function loadPaymentContext(): PendingPayment | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const entry = JSON.parse(raw) as PendingPayment;

    // Validate required fields
    if (!entry.prompt || !entry.tier || !entry.chatId || !entry.messageId) {
      clearPaymentContext();
      return null;
    }

    // Check TTL
    if (Date.now() - entry.storedAt > TTL_MS) {
      clearPaymentContext();
      return null;
    }

    return entry;
  } catch {
    clearPaymentContext();
    return null;
  }
}

/**
 * Remove stored payment context (called after successful payment or on expiry).
 */
export function clearPaymentContext(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — best-effort cleanup.
  }
}
