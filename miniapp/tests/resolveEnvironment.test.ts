import { describe, it, expect } from 'vitest';
import { resolveEnvironment, createPaymentStrategy } from '../src/payment/factory';

describe('resolveEnvironment', () => {
  it('returns telegram-webview when in TG WebView', () => {
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: undefined,
      botLinkedWallet: null,
    });
    expect(result).toBe('telegram-webview');
  });

  it('returns telegram-webview even with account in TG WebView', () => {
    // starknet-react may cache account from localStorage, but extension
    // cannot sign in TG WebView — must still return telegram-webview
    const result = resolveEnvironment({
      isTelegramWebView: true,
      account: {} as any,
      botLinkedWallet: null,
    });
    expect(result).toBe('telegram-webview');
  });

  it('returns starknet-wallet when account is connected in browser', () => {
    const result = resolveEnvironment({
      isTelegramWebView: false,
      account: {} as any,
      botLinkedWallet: null,
    });
    expect(result).toBe('starknet-wallet');
  });

  it('returns bot-linked-readonly when bot wallet linked in browser', () => {
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
});
