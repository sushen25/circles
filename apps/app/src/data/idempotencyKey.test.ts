import { IdempotencyKey } from '@circles/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { newIdempotencyKey } from './functions';

/**
 * Found on the Android emulator (S3-01a): Hermes has no `crypto.randomUUID`,
 * so every mutation the app sent threw before it left the device. The key
 * comes from `expo-crypto` where the runtime has none of its own.
 */
describe('newIdempotencyKey', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a key on a runtime with no crypto.randomUUID, as Hermes has none', () => {
    vi.stubGlobal('crypto', { subtle: globalThis.crypto.subtle });
    const key = newIdempotencyKey();
    expect(IdempotencyKey.safeParse(key).success).toBe(true);
    expect(newIdempotencyKey()).not.toBe(key);
  });

  it("uses the runtime's own where there is one", () => {
    expect(IdempotencyKey.safeParse(newIdempotencyKey()).success).toBe(true);
  });
});
