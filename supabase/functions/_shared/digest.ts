import { isHosted, optional } from './env.ts';
import { sha256Hex } from './hash.ts';
import { Unavailable } from './problem.ts';

/**
 * The digest an invite secret or a re-entry token is stored under (SUS-214,
 * ADR 0081, amending ADR 0028).
 *
 * HMAC-SHA-256 under `INVITE_DIGEST_KEY`, a secret only the Edge Functions
 * hold. The database stores the result and never sees the key, so a copy of
 * `circle_invites` or `email_action_tokens` cannot be turned into a working
 * link, and a stored digest cannot be recomputed from a guessed secret either.
 *
 * **There is no fallback.** A function without the key answers 503 and does
 * nothing, on a laptop as well as on a hosted project: the plain SHA-256 is
 * never used for a *new* digest. (Contrast `verifyTurnstile`, which may skip on
 * a laptop because it is not load-bearing; this key is.) The one place SHA-256
 * survives is {@link legacy}: the digest of a link made before this change,
 * offered to the database beside the HMAC so that links already in group chats
 * keep working, for as long as ADR 0081 says.
 *
 * The key is one secret with a context string per purpose, so a digest made for
 * one purpose is not valid for the other.
 */

const CONTEXT = 'circles.digest.v1:';

/** A hosted key shorter than this is a typo or a placeholder, not a key. */
const MIN_HOSTED_KEY = 32;

export interface Digests {
  /** `\x…` of the HMAC: how every new digest is stored and how it is looked up first. */
  current: string;
  /**
   * `\x…` of the plain SHA-256, for the links made before the key. Passed to
   * the database only so that those keep working; it is never stored for a new
   * link.
   */
  legacy: string;
}

/**
 * Fails with 503 unless the key is usable. For a function that charges an
 * allowance before it hashes anything: it asks first, so a deployment that cannot
 * make a digest costs the caller nothing.
 */
export function assertDigestKey(): void {
  key();
}

function key(): string {
  const value = optional('INVITE_DIGEST_KEY');
  if (value === undefined || (isHosted() && value.length < MIN_HOSTED_KEY)) {
    // The wrapper logs the 503 against the function; the key is never in a message.
    throw new Unavailable();
  }
  return value;
}

async function hmacHex(purpose: 'invite' | 'reentry', value: string): Promise<string> {
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmac, encoder.encode(`${CONTEXT}${purpose}:${value}`)),
  );
  return `\\x${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The digests of an invite secret (the Join link's fragment). */
export async function inviteDigests(secret: string): Promise<Digests> {
  return { current: await hmacHex('invite', secret), legacy: await sha256Hex(secret) };
}

/** The digests of an emailed re-entry token. */
export async function reentryDigests(token: string): Promise<Digests> {
  return { current: await hmacHex('reentry', token), legacy: await sha256Hex(token) };
}
