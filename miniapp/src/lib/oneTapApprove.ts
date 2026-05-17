const STRK_WEI = 1_000_000_000_000_000_000n;
const U128_MASK = (1n << 128n) - 1n;

export type OneTapUrlValidationErrorCode = 'missing_chat_id' | 'missing_credential';

export type OneTapUrlValidationResult =
  | { ok: true }
  | { ok: false; code: OneTapUrlValidationErrorCode; message: string };

export interface SessionWalletResponse {
  dust_value: number | string;
  spender_address: string;
  amount_to_approve_strk?: number | string;
  amount_to_approve_wei?: number | string;
  amount_to_approve_display?: string;
}

export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

export function toU256Calldata(value: bigint): [string, string] {
  if (value < 0n) {
    throw new Error('Invalid u256 amount: negative value.');
  }

  const low = value & U128_MASK;
  const high = value >> 128n;
  return [low.toString(), high.toString()];
}

export function buildStrkApproveCall(input: {
  strkTokenAddress: string;
  spenderAddress: string;
  amountWei: bigint;
}): StarknetCall {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(input.strkTokenAddress)) {
    throw new Error('Invalid STRK token address.');
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(input.spenderAddress)) {
    throw new Error('Invalid approval spender address.');
  }

  return {
    contractAddress: input.strkTokenAddress,
    entrypoint: 'approve',
    calldata: [input.spenderAddress, ...toU256Calldata(input.amountWei)],
  };
}

export function validateOneTapUrlContext(input: {
  chatId: string | null | undefined;
  credential: string | null | undefined;
}): OneTapUrlValidationResult {
  if (!input.chatId) {
    return {
      ok: false,
      code: 'missing_chat_id',
      message: 'Missing chat id. Open this approval link from Telegram.',
    };
  }

  if (!input.credential) {
    return {
      ok: false,
      code: 'missing_credential',
      message:
        'This approval link is missing its approval code/token. Go back to Telegram and open the latest approval button again.',
    };
  }

  return { ok: true };
}

export function resolveRelayerBaseUrl(env: Record<string, unknown>): string {
  const raw = (env.VITE_RELAYER_URL as string | undefined) || 'https://api.smainer.io';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      'Invalid relayer URL. Set VITE_RELAYER_URL to a full https:// URL (example: https://api.smainer.io).'
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid relayer URL protocol. Use http:// or https://.');
  }

  return raw.replace(/\/+$/, '');
}

export type ApprovalCredentialMode = 'token' | 'code';

export function getApprovalCredentialMode(credential: string): ApprovalCredentialMode {
  return credential.startsWith('ot1.') ? 'token' : 'code';
}

export function buildSessionWalletHeaders(credential: string): Record<string, string> {
  const mode = getApprovalCredentialMode(credential);
  if (mode === 'token') {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential}`,
    };
  }
  return {
    'Content-Type': 'application/json',
    'X-One-Tap-Code': credential,
  };
}

export function safeDecodeUrlComponent(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return decodeURIComponent(trimmed);
  } catch {
    // If the value contains stray '%' sequences or is already decoded,
    // return it as-is rather than throwing.
    return trimmed;
  }
}

export function resolveApprovalCredential(input: {
  credentialFromPath?: string | null | undefined;
  credentialFromQuery?: string | null | undefined;
}): string | null {
  return (
    safeDecodeUrlComponent(input.credentialFromPath) ?? safeDecodeUrlComponent(input.credentialFromQuery)
  );
}

/** Backward-compatible alias (legacy name). */
export function resolveOneTapToken(input: {
  tokenFromPath?: string | null | undefined;
  tokenFromQuery?: string | null | undefined;
}): string | null {
  return resolveApprovalCredential({
    credentialFromPath: input.tokenFromPath,
    credentialFromQuery: input.tokenFromQuery,
  });
}

/** Backward-compatible alias (legacy name). */
export function buildOneTapAuthHeaders(token: string): Record<string, string> {
  return buildSessionWalletHeaders(token);
}

export function extractIntegerField(rawJson: string, fieldName: string): string | null {
  const match = rawJson.match(new RegExp(`"${fieldName}"\\s*:\\s*"?(\\d+)"?`));
  return match?.[1] ?? null;
}

function parseRequiredPositiveBigint(value: string, context: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid session ${context}.`);
  }
  if (parsed <= 0n) {
    throw new Error(`Invalid session ${context}.`);
  }
  return parsed;
}

export function formatStrkFromWei(amountWei: bigint): string {
  const whole = amountWei / STRK_WEI;
  const fractional = amountWei % STRK_WEI;
  if (fractional === 0n) return whole.toString();
  return `${whole}.${fractional.toString().padStart(18, '0').replace(/0+$/, '')}`;
}

export function parseSessionWallet(rawText: string): {
  session: SessionWalletResponse;
  amountWei: bigint;
  dustWei: bigint;
  totalApproveWei: bigint;
  amountDisplayStrk: string;
} {
  const session: SessionWalletResponse = JSON.parse(rawText);

  // Prefer wei field (browser-safe via raw-text extraction to avoid JS float rounding).
  const amountWeiRaw =
    extractIntegerField(rawText, 'amount_to_approve_wei') ??
    (typeof session.amount_to_approve_wei === 'string' ? session.amount_to_approve_wei : null);

  let amountWei: bigint | null = null;

  if (amountWeiRaw) {
    amountWei = parseRequiredPositiveBigint(amountWeiRaw, 'amount (amount_to_approve_wei)');
  } else {
    const amountStrkRaw =
      extractIntegerField(rawText, 'amount_to_approve_strk') ??
      (typeof session.amount_to_approve_strk === 'string'
        ? session.amount_to_approve_strk
        : typeof session.amount_to_approve_strk === 'number'
          ? String(session.amount_to_approve_strk)
          : null);

    if (!amountStrkRaw) {
      throw new Error('Invalid session amount: missing amount_to_approve_wei/amount_to_approve_strk.');
    }

    const amountStrk = parseRequiredPositiveBigint(amountStrkRaw, 'amount (amount_to_approve_strk)');
    amountWei = amountStrk * STRK_WEI;
  }

  const dustRaw =
    extractIntegerField(rawText, 'dust_value') ??
    (typeof session.dust_value === 'string'
      ? session.dust_value
      : typeof session.dust_value === 'number'
        ? String(session.dust_value)
        : null);
  const dustWei = dustRaw ? BigInt(dustRaw) : 0n;

  const totalApproveWei = amountWei + dustWei;
  const amountDisplayStrk = formatStrkFromWei(amountWei);

  return {
    session: { ...session, amount_to_approve_display: amountDisplayStrk },
    amountWei,
    dustWei,
    totalApproveWei,
    amountDisplayStrk,
  };
}

export function buildBraavosApproveUrl(input: { chatId: string; credential?: string | null }): string {
  const encodedChatId = encodeURIComponent(input.chatId);
  const encodedCredential = input.credential ? encodeURIComponent(input.credential) : null;

  // Conservative Braavos deeplink shape: `.../dapp/<host>/<path>`.
  // Keep token/code in the path (some handlers drop query params).
  const targetPath = encodedCredential
    ? `/approve/${encodedChatId}/${encodedCredential}`
    : `/approve/${encodedChatId}`;
  return `https://link.braavos.app/dapp/smainer-miniapp.vercel.app${targetPath}`;
}
