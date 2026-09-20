/**
 * Is this request from the email provider? (Architecture §13: "verify Svix
 * signature".)
 *
 * Resend signs its webhooks the Svix way, which is small enough to own rather
 * than import (non-negotiable 11): HMAC-SHA256, keyed with the base64 half of a
 * `whsec_…` secret, over `<svix-id>.<svix-timestamp>.<raw body>`, sent as one
 * or more space-separated `v1,<base64>` entries in `svix-signature` — more than
 * one while a secret is being rotated. Any one matching is enough.
 *
 * The timestamp is part of what is signed and must be within five minutes of
 * now, so a captured request cannot be replayed next week. Within those five
 * minutes a replay is the same event again, and the database stores an event
 * once (`record_email_delivery`), so it changes nothing.
 *
 * The raw body is what is signed. Verifying a re-serialised parse of it would
 * verify something the provider never sent.
 */

export const TOLERANCE_SECONDS = 5 * 60;

export type SvixVerdict = 'ok' | 'missing_headers' | 'stale' | 'bad_signature' | 'bad_secret';

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Constant-time, so a forged signature cannot be narrowed by how long it took. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export async function verifySvix(input: {
  secret: string;
  headers: Headers;
  body: string;
  /** Seconds since the epoch. */
  now: number;
}): Promise<SvixVerdict> {
  const id = input.headers.get('svix-id');
  const timestamp = input.headers.get('svix-timestamp');
  const signatures = input.headers.get('svix-signature');
  if (id === null || timestamp === null || signatures === null) return 'missing_headers';

  const sent = Number(timestamp);
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(input.now - sent) > TOLERANCE_SECONDS) {
    return 'stale';
  }

  const key = base64ToBytes(input.secret.replace(/^whsec_/, ''));
  if (key === null || key.length === 0) return 'bad_secret';

  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      hmac,
      new TextEncoder().encode(`${id}.${timestamp}.${input.body}`),
    ),
  );

  for (const entry of signatures.split(' ')) {
    const [version, signature] = entry.split(',', 2);
    if (version !== 'v1' || signature === undefined) continue;
    const given = base64ToBytes(signature);
    if (given !== null && sameBytes(given, expected)) return 'ok';
  }
  return 'bad_signature';
}
