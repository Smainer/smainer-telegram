import { describe, it, expect } from 'vitest';
import { resolveEnvironment, createPaymentStrategy } from '../src/payment/factory';

describe('resolveEnvironment', () => {
  // -----------------------------------------------------------------------
  // Telegram WebView scenarios
  // -----------------------------------------------------------------------

  it('returns telegram-webview when in TG WebView with NO bot-linked wallet', () => {
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: undefined,
      botLinkedWallet: null,
    });
    expect(result).toBe('telegram-webview');
  });

  it('returns telegram-webview even with cached account in TG WebView (no bot wallet)', () => {
    // starknet-react may cache account from localStorage, but extension
    // cannot sign in TG WebView — must still return telegram-webview
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: {} as any,
      botLinkedWallet: null,
    });
    expect(result).toBe('telegram-webview');
  });

  // -----------------------------------------------------------------------
  // REGRESSION: TG WebView + bot-linked wallet → bot-linked-readonly
  // -----------------------------------------------------------------------

  it('returns bot-linked-readonly when in TG WebView WITH bot-linked wallet', () => {
    // FIX for "Pay with Braavos" chooser: user already linked wallet via
    // /link — the MiniApp should route them to the bot-linked flow, NOT
    // show WalletPayButtons redirect chooser.
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: undefined,
      botLinkedWallet: '0x04a3',
    });
    expect(result).toBe('bot-linked-readonly');
    expect(result).not.toBe('telegram-webview');
  });

  it('returns bot-linked-readonly when in TG WebView with BOTH cached account AND bot wallet', () => {
    // Even with a stale starknet-react account, the bot-linked flow is
    // the only one that works in TG WebView (no redirect needed).
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: {} as any,
      botLinkedWallet: '0x04a3',
    });
    expect(result).toBe('bot-linked-readonly');
  });

  it('TG WebView + bot wallet strategy has requiresRedirect=false and canSign=false', () => {
    // Verifies the strategy produced for this scenario doesn't show the
    // wallet chooser and the CTA is actionable (no signing needed).
    const strategy = createPaymentStrategy({
      isTelegramWebView: true,
      account: undefined,
      botLinkedWallet: '0x04a3',
      checkAllowance: async () => 0n,
      onProgress: () => {},
    });
    const caps = strategy.getCapabilities();
    expect(caps.requiresRedirect).toBe(false);
    expect(caps.canSign).toBe(false);
    expect(caps.ctaLabel).toBe('Request Payment via Bot');
  });

  // -----------------------------------------------------------------------
  // Standalone browser scenarios
  // -----------------------------------------------------------------------

  it('returns starknet-wallet when account is connected in browser', () => {
    const result = resolveEnvironment({
      isTelegramWebView: false,
      account: {} as any,
      botLinkedWallet: null,
    });
    expect(result).toBe('starknet-wallet');
  });

  it('returns starknet-wallet when account connected in browser even with bot wallet', () => {
    // Real signing account takes precedence over bot-linked in browser
    const result = resolveEnvironment({
      isTelegramWebView: false,
      account: {} as any,
      botLinkedWallet: '0x04a3',
    });
    expect(result).toBe('starknet-wallet');
  });

  it('returns bot-linked-readonly when bot wallet linked in browser (no account)', () => {
    const result = resolveEnvironment({
      isTelegramWebView: false,
      account: undefined,
      botLinkedWallet: '0x04a3',
    });
    expect(result).toBe('bot-linked-readonly');
  });

  it('returns bot-linked-readonly (NOT telegram-webview) as fallback in browser', () => {
    // THIS IS THE CRITICAL FIX: standalone browser with no wallet must NOT
    // get requiresRedirect=true, which causes the wallet-choice loop.
    const result = resolveEnvironment({
      isTelegramWebView: false,
      account: undefined,
      botLinkedWallet: null,
    });
    expect(result).toBe('bot-linked-readonly');
    // Must NOT be telegram-webview (which has requiresRedirect: true → loop)
    expect(result).not.toBe('telegram-webview');
  });

  it('standalone browser fallback has requiresRedirect=false', () => {
    // Verify the strategy created for standalone browser doesn't redirect
    const strategy = createPaymentStrategy({
      isTelegramWebView: false,
      account: undefined,
      botLinkedWallet: null,
      checkAllowance: async () => 0n,
      onProgress: () => {},
    });
    const caps = strategy.getCapabilities();
    expect(caps.requiresRedirect).toBe(false);
  });

  // -----------------------------------------------------------------------
  // REGRESSION: bot-linked CTA must be clickable (canSign=false path)
  // -----------------------------------------------------------------------

  it('bot-linked-readonly strategy ctaLabel is Request Payment via Bot', () => {
    const strategy = createPaymentStrategy({
      isTelegramWebView: false,
      account: undefined,
      botLinkedWallet: '0x04a3',
      checkAllowance: async () => 0n,
      onProgress: () => {},
    });
    const caps = strategy.getCapabilities();
    expect(caps.canSign).toBe(false);
    expect(caps.ctaLabel).toBe('Request Payment via Bot');
    // CTA should NOT require `account` — only needs effectiveAddress.
    // This is enforced in PaymentFlow.tsx:
    //   disabled = capabilities.canSign ? (!isContractReady || !account) : !effectiveAddress
  });
});
