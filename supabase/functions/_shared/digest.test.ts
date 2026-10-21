import { beforeEach, describe, expect, it } from 'vitest';

import { inviteDigests, reentryDigests } from './digest.ts';
import { Unavailable } from './problem.ts';

/**
 * The digest an invite secret or a re-entry token is stored under (SUS-214,
 * ADR 0082). HMAC-SHA-256 under `INVITE_DIGEST_KEY`, held by the Edge Functions
 * and never by the database, so a copy of the tables cannot reproduce it.
 */

const KEY = 'k'.repeat(32);
const SECRET = 's'.repeat(43);
const HOSTED = 'https://pcfekupwqrdfryeaqggx.supabase.co';

beforeEach(() => {
  process.env.INVITE_DIGEST_KEY = KEY;
  process.env.SUPABASE_URL = 'http://127.0.0.1:54421';
  process.env.CIRCLES_ENV = 'local';
});

/** The expected bytes, from Web Crypto directly rather than through the module under test. */
async function expectedMac(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(message)));
  return `\\x${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
async function expectedSha(message: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)),
  );
  return `\\x${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('inviteDigests', () => {
  it('is the HMAC of the secret under the key, in the form a bytea takes', async () => {
    const { current } = await inviteDigests(SECRET);
    expect(current).toBe(await expectedMac(KEY, `circles.digest.v1:invite:${SECRET}`));
  });

  it('also names the legacy SHA-256, which is only for links made before the key', async () => {
    const { legacy } = await inviteDigests(SECRET);
    expect(legacy).toBe(await expectedSha(SECRET));
  });

  it('cannot be recomputed without the key', async () => {
    const withKey = (await inviteDigests(SECRET)).current;
    process.env.INVITE_DIGEST_KEY = 'z'.repeat(32);
    expect((await inviteDigests(SECRET)).current).not.toBe(withKey);
    expect(withKey).not.toBe((await inviteDigests(SECRET)).legacy);
  });

  it('is separated by purpose: an invite digest is not a re-entry digest', async () => {
    expect((await inviteDigests(SECRET)).current).not.toBe((await reentryDigests(SECRET)).current);
  });
});

describe('reentryDigests', () => {
  it('is the HMAC of the token under the key, with its own context', async () => {
    const { current } = await reentryDigests(SECRET);
    expect(current).toBe(await expectedMac(KEY, `circles.digest.v1:reentry:${SECRET}`));
  });
});

describe('the key is never optional', () => {
  it('fails closed when it is missing, on a laptop too, and never falls back to SHA-256', async () => {
    delete process.env.INVITE_DIGEST_KEY;
    await expect(inviteDigests(SECRET)).rejects.toBeInstanceOf(Unavailable);
    await expect(reentryDigests(SECRET)).rejects.toBeInstanceOf(Unavailable);
  });

  it('fails closed when it is empty', async () => {
    process.env.INVITE_DIGEST_KEY = '';
    await expect(inviteDigests(SECRET)).rejects.toBeInstanceOf(Unavailable);
  });

  it('refuses a short key on a hosted project, where a guessable one defeats the point', async () => {
    process.env.SUPABASE_URL = HOSTED;
    process.env.CIRCLES_ENV = 'hosted';
    process.env.INVITE_DIGEST_KEY = 'local';
    await expect(inviteDigests(SECRET)).rejects.toBeInstanceOf(Unavailable);
    process.env.INVITE_DIGEST_KEY = KEY;
    await expect(inviteDigests(SECRET)).resolves.toBeDefined();
  });

  it('accepts the short local value on a laptop', async () => {
    process.env.INVITE_DIGEST_KEY = 'local';
    await expect(inviteDigests(SECRET)).resolves.toBeDefined();
  });
});
