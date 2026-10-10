import { sameSecret } from './secret.ts';

/**
 * The short-lived token a calendar link carries (ADR 0063).
 *
 * `<exp>.<mac>`: `exp` is the expiry in whole seconds since the epoch, and
 * `mac` is base64url of HMAC-SHA-256 over `circles.calendar.v1:<id>:<exp>` under
 * `CALENDAR_LINK_KEY`. The confirmation's id is inside the MAC, so a token is
 * good for exactly one confirmation and for nothing else the function does; the
 * context string is domain separation, so the key may one day sign something
 * else and a signature for one purpose is never one for another.
 *
 * Nothing is stored. Checking recomputes the MAC, compares in constant time,
 * and only then looks at the clock, so a forged expiry is a bad signature and
 * not a hint about the clock.
 *
 * **Not single-use**, on purpose: iOS may ask for the link twice (a preview and
 * then the open). Replay is bounded by the lifetime, and what a replay reads is
 * what the plan's public link already shows.
 */
export const CALENDAR_TOKEN_SECONDS = 15 * 60;

const CONTEXT = 'circles.calendar.v1:';

export type TokenCheck = 'ok' | 'expired' | 'invalid';

async function mac(key: string, confirmationId: string, exp: number): Promise<string> {
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmac,
    encoder.encode(`${CONTEXT}${confirmationId}:${exp}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function signCalendarToken(
  key: string,
  confirmationId: string,
  nowMs: number,
  seconds: number = CALENDAR_TOKEN_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  const exp = Math.floor(nowMs / 1000) + seconds;
  return {
    token: `${exp}.${await mac(key, confirmationId, exp)}`,
    expiresAt: new Date(exp * 1000),
  };
}

export async function checkCalendarToken(
  key: string,
  token: string,
  confirmationId: string,
  nowMs: number,
): Promise<TokenCheck> {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (match === null) return 'invalid';
  const exp = Number(match[1]);
  const expected = await mac(key, confirmationId, exp);
  if (!sameSecret(match[2] ?? '', expected)) return 'invalid';
  return Math.floor(nowMs / 1000) < exp ? 'ok' : 'expired';
}
