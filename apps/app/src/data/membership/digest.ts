import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync } from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * SHA-256 of an invite secret, in the form PostgREST takes a `bytea` in:
 * lowercase hex behind a `\x` (S1-24, S3-01a).
 *
 * One function, two engines, one answer. The web hashes with Web Crypto, which
 * exists only in a secure context (`localhost` counts, so development and the
 * e2e suite are unaffected). Hermes has no `crypto.subtle` at all, so native
 * hashes with `expo-crypto`, which is the platform's own SHA-256. Both are
 * pinned to the same published vector in `digest.test.ts`, because a digest
 * that differs by one character between the two is an invite that works in the
 * browser and says "this link is not live" in the app.
 *
 * Hashed on the device so the secret is never a statement parameter, which is
 * the same care `redeem-invite` takes server-side (§14).
 */
export async function secretDigest(secret: string): Promise<string> {
  const hex = Platform.OS === 'web' ? await webSha256Hex(secret) : await nativeSha256Hex(secret);
  return `\\x${hex}`;
}

/** Web Crypto. Exported for the vector test only. */
export async function webSha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('no Web Crypto available to hash the invite');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `expo-crypto`. Exported for the vector test only.
 *
 * It hashes the string's UTF-8 bytes, as `TextEncoder` does on the web, and
 * returns hex. Lowercased anyway: `bytea` input does not care, but the vector
 * test does, and a platform that one day answered in capitals should fail
 * there rather than nowhere.
 */
export async function nativeSha256Hex(text: string): Promise<string> {
  const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, text, {
    encoding: CryptoEncoding.HEX,
  });
  return hex.toLowerCase();
}
