import { describe, it, expect } from 'vitest';

import {
  resolveRelayerBaseUrl,
  buildSessionWalletHeaders,
  validateOneTapUrlContext,
  parseSessionWallet,
  resolveApprovalCredential,
  buildBraavosApproveUrl,
  buildStrkApproveCall,
  toU256Calldata,
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

  it('buildSessionWalletHeaders uses Authorization Bearer for legacy ot1 tokens (backward compatible)', () => {
    const headers = buildSessionWalletHeaders('ot1.tokenpayload.sig');
    expect(headers.Authorization).toBe('Bearer ot1.tokenpayload.sig');
    expect(headers).not.toHaveProperty('X-One-Tap-Code');
    expect(headers).not.toHaveProperty('X-API-Key');
  });

  it('buildSessionWalletHeaders uses X-One-Tap-Code for short approve codes (no Authorization header)', () => {
    const headers = buildSessionWalletHeaders('ABCdef1234567890');
    expect(headers).toHaveProperty('X-One-Tap-Code', 'ABCdef1234567890');
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('X-API-Key');
  });

  it('validateOneTapUrlContext returns missing_credential when credential absent', () => {
    const result = validateOneTapUrlContext({ chatId: '123', credential: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing_credential');
      expect(result.message.toLowerCase()).toContain('missing');
      expect(result.message.toLowerCase()).toContain('code');
    }
  });

  it('resolveApprovalCredential prefers path credential over query credential', () => {
    const credential = resolveApprovalCredential({
      credentialFromPath: 'pathCredential',
      credentialFromQuery: 'queryCredential',
    });
    expect(credential).toBe('pathCredential');
  });

  it('resolveApprovalCredential falls back to query credential when path credential is absent', () => {
    const credential = resolveApprovalCredential({ credentialFromPath: null, credentialFromQuery: 'queryCredential' });
    expect(credential).toBe('queryCredential');
  });

  it('resolveApprovalCredential returns null when both path and query values are missing/blank', () => {
    const credential = resolveApprovalCredential({ credentialFromPath: undefined, credentialFromQuery: '   ' });
    expect(credential).toBe(null);
  });

  it('resolveApprovalCredential safely decodes percent-encoded values', () => {
    const credential = resolveApprovalCredential({
      credentialFromPath: 'abc%2Fdef%3D%3D',
      credentialFromQuery: null,
    });
    expect(credential).toBe('abc/def==');
  });

  it('buildBraavosApproveUrl uses a conservative Braavos deeplink shape (host + path)', () => {
    const url = buildBraavosApproveUrl({ chatId: '123', credential: 'abc/def==' });
    expect(url).toBe('https://link.braavos.app/dapp/smainer-miniapp.vercel.app/approve/123/abc%2Fdef%3D%3D');
  });

  it('buildBraavosApproveUrl works without credential (still routes to /approve/:chatId)', () => {
    const url = buildBraavosApproveUrl({ chatId: '123', credential: null });
    expect(url).toBe('https://link.braavos.app/dapp/smainer-miniapp.vercel.app/approve/123');
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

  it('toU256Calldata splits bigint values into low/high felts', () => {
    expect(toU256Calldata(0n)).toEqual(['0', '0']);
    expect(toU256Calldata((1n << 128n) + 5n)).toEqual(['5', '1']);
  });

  it('buildStrkApproveCall builds raw approve calldata without ABI validation', () => {
    const call = buildStrkApproveCall({
      strkTokenAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      spenderAddress: '0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe',
      amountWei: 100000000000000000n + 42n,
    });

    expect(call).toEqual({
      contractAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      entrypoint: 'approve',
      calldata: [
        '0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe',
        '100000000000000042',
        '0',
      ],
    });
  });
});
