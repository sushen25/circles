import { createHash, randomBytes } from 'node:crypto';

/**
 * `expo-crypto`, for a runtime that is not a phone.
 *
 * The real package imports `expo-modules-core`, which cannot load under Vitest
 * (see `expo-secure-store-stub.ts`). This implements the one call the app makes
 * with Node's own SHA-256 over the string's UTF-8 bytes, which is what the
 * native module does, so `digest.test.ts` can pin the native path's framing —
 * hex, lowercase, the `\x` prefix — to the same vector as the web's. That the
 * phone's SHA-256 is SHA-256 is proved on the emulator, where a joined invite
 * is the proof (the testing notes' `/join` step).
 */
export enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
}

export enum CryptoEncoding {
  HEX = 'hex',
  BASE64 = 'base64',
}

export async function digestStringAsync(
  algorithm: CryptoDigestAlgorithm,
  data: string,
  options: { encoding: CryptoEncoding } = { encoding: CryptoEncoding.HEX },
): Promise<string> {
  if (algorithm !== CryptoDigestAlgorithm.SHA256) throw new Error(`stub: ${algorithm}`);
  return createHash('sha256')
    .update(data, 'utf8')
    .digest(options.encoding === CryptoEncoding.HEX ? 'hex' : 'base64');
}

/** A v4 UUID, as the native module makes one. */
export function randomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
