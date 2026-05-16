import { describe, it, expect } from 'vitest';

import {
  resolveRelayerBaseUrl,
  buildOneTapAuthHeaders,
  validateOneTapUrlContext,
  parseSessionWallet,
} from '../src/lib/oneTapApprove';

describe('oneTapApprove helpers', () => {
  it('resolveRelayerBaseUrl uses VITE_RELAYER_URL when valid', () => {
    const baseUrl = resolveRelayerBaseUrl({ VITE_RELAYER_URL: 'https://relayer.example.com/' });
    expect(baseUrl).toBe('https://relayer.example.com');
  });

  it('resolveRelayerBaseUrl falls back to https://api.smainer.io (never localhost)', () => {
    const baseUrl = resolveRelayerBaseUrl({});
    expect(baseUrl).toBe('https://api.smainer.io');
    expect(baseUrl).not.toContain('localhost');
    expect(baseUrl).not.toContain('127.0.0.1');
  });

  it('resolveRelayerBaseUrl throws on malformed URL', () => {
    expect(() => resolveRelayerBaseUrl({ VITE_RELAYER_URL: 'api.smainer.io' })).toThrow(/Invalid relayer URL/i);
  });

  it('buildOneTapAuthHeaders uses Authorization Bearer and does not include API key headers', () => {
    const headers = buildOneTapAuthHeaders('token123');
    expect(headers.Authorization).toBe('Bearer token123');
    expect(headers).not.toHaveProperty('X-API-Key');
  });

  it('validateOneTapUrlContext returns missing_token when token absent', () => {
    const result = validateOneTapUrlContext({ chatId: '123', token: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing_token');
      expect(result.message.toLowerCase()).toContain('missing');
    }
  });

  it('parseSessionWallet prefers amount_to_approve_wei and keeps bigint precision via raw text', () => {
    const raw = JSON.stringify({
      dust_value: "10",
      spender_address: '0xabc',
      amount_to_approve_wei: "5000000000000000000"
    });

    const parsed = parseSessionWallet(raw);
    expect(parsed.amountWei).toBe(5_000_000_000_000_000_000n);
    expect(parsed.dustWei).toBe(10n);
    expect(parsed.totalApproveWei).toBe(5_000_000_000_000_000_010n);
    expect(parsed.session.amount_to_approve_display).toBe('5');
  });

  it('parseSessionWallet falls back to amount_to_approve_strk only when wei is missing', () => {
    const raw = JSON.stringify({
      dust_value: 0,
      spender_address: '0xabc',
      amount_to_approve_strk: 7,
    });

    const parsed = parseSessionWallet(raw);
    expect(parsed.amountWei).toBe(7_000_000_000_000_000_000n);
    expect(parsed.session.amount_to_approve_display).toBe('7');
  });

  it('parseSessionWallet throws when both amount fields are missing (no default 0)', () => {
    const raw = JSON.stringify({
      dust_value: 0,
      spender_address: '0xabc',
    });

    expect(() => parseSessionWallet(raw)).toThrow(/missing amount/i);
  });
});
