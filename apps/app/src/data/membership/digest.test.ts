import { describe, expect, it } from 'vitest';

import { nativeSha256Hex, secretDigest, webSha256Hex } from './digest';

/**
 * The invite digest is computed by two engines — Web Crypto in the browser,
 * `expo-crypto` in the app — and the database has one `invite_secret_hash`.
 * Both are held to published SHA-256 vectors (FIPS 180-2, and the pangram
 * everyone quotes), so neither can drift from the other without failing here.
 */
const VECTORS = [
  {
    text: 'abc',
    hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    text: 'The quick brown fox jumps over the lazy dog',
    hex: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
  },
] as const;

describe('invite digest', () => {
  it.each(VECTORS)('web and native agree with the published vector for "$text"', async (v) => {
    expect(await webSha256Hex(v.text)).toBe(v.hex);
    expect(await nativeSha256Hex(v.text)).toBe(v.hex);
  });

  it('hashes the UTF-8 bytes on both, so a secret outside ASCII is the same secret', async () => {
    const text = 'café-crew-☕-'.repeat(2);
    expect(await nativeSha256Hex(text)).toBe(await webSha256Hex(text));
  });

  it('frames it as PostgREST takes a bytea: \\x and lowercase hex', async () => {
    expect(await secretDigest(VECTORS[1].text)).toBe(`\\x${VECTORS[1].hex}`);
  });
});
