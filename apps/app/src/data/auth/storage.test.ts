import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storageForTests } from './storage';

/**
 * The session store, on both platforms, from one test run.
 *
 * `storage.ts` picks between them by `Platform.OS`, so exercising the chosen
 * one only ever tests half of it. Both are exported for this reason: the native
 * half is where the interesting failures are, and jsdom is not Android.
 */

const { web, secure, CHUNK_SIZE } = storageForTests;

/** A minimal in-memory `expo-secure-store` with Android's one real constraint. */
const store = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    // Android's `EncryptedSharedPreferences` refuses anything larger. A mock
    // that accepts it would let the bug this chunking exists for pass.
    if (value.length > 2048) throw new Error('value too large');
    store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    store.delete(key);
  },
}));

beforeEach(() => {
  store.clear();
  globalThis.localStorage.clear();
});

describe('native, where values are chunked', () => {
  it('round-trips a value small enough to store whole', async () => {
    await secure.setItem('k', 'small');

    expect(await secure.getItem('k')).toBe('small');
    expect(store.size).toBe(1);
  });

  it('round-trips a session far larger than Android will take', async () => {
    // What a real one looks like: two JWTs and a user object with metadata.
    const session = 'x'.repeat(CHUNK_SIZE * 3 + 17);

    await secure.setItem('k', session);

    expect(await secure.getItem('k')).toBe(session);
  });

  it('reads correctly across a shrink and a re-grow', async () => {
    const long = 'A'.repeat(CHUNK_SIZE * 4);
    const short = 'B'.repeat(CHUNK_SIZE * 2);

    await secure.setItem('k', long);
    await secure.setItem('k', short);
    expect(await secure.getItem('k')).toBe(short);

    await secure.setItem('k', 'C'.repeat(CHUNK_SIZE * 4));
    expect(await secure.getItem('k')).toBe('C'.repeat(CHUNK_SIZE * 4));
  });

  it('leaves nothing on disk after a shrink, so sign-out can clear all of it', async () => {
    /**
     * This is what clearing before a write buys, and it is **not** correctness
     * of reads — the header carries the chunk count, so chunks past it are
     * never read back. It is that they are never *left*.
     *
     * Four chunks then two, without the clear, strands chunks 2 and 3. A later
     * `removeItem` deletes only what the current header counts, so those two
     * survive sign-out: fragments of a real session token, sitting in secure
     * storage on a shared or lost device, belonging to somebody who believes
     * they signed out. The first draft of this test asserted the read instead
     * and passed against code with the clear removed — which is how I found
     * out it was asserting the wrong property.
     */
    await secure.setItem('k', 'A'.repeat(CHUNK_SIZE * 4));
    await secure.setItem('k', 'B'.repeat(CHUNK_SIZE * 2));

    await secure.removeItem('k');

    expect([...store.keys()]).toEqual([]);
  });

  it('reads a half-written value as absent rather than as a truncated session', async () => {
    await secure.setItem('k', 'D'.repeat(CHUNK_SIZE * 3));
    // A partial restore from a backup. The write order makes this unreachable
    // by interruption; it is still what a reader must not misread.
    store.delete('k.a.1');

    // Not the prefix: `supabase-js` would be handed unparseable JSON on every
    // start, and the person would be stuck rather than merely signed out.
    expect(await secure.getItem('k')).toBeNull();
  });

  it('removes every chunk, so nothing is recoverable after a sign-out', async () => {
    await secure.setItem('k', 'E'.repeat(CHUNK_SIZE * 3));

    await secure.removeItem('k');

    expect(store.size).toBe(0);
  });

  it('returns null for a key it has never seen', async () => {
    expect(await secure.getItem('nothing')).toBeNull();
  });

  it('keeps the previous session when a write fails halfway', async () => {
    /**
     * Token refresh runs roughly hourly, so a write that can strand the user is
     * a write that strands users regularly. Clearing first and writing second
     * loses a *valid* refresh token to any failure in between; this writes a new
     * generation and switches the header last, so an interrupted write is
     * invisible.
     */
    const first = 'A'.repeat(CHUNK_SIZE * 3);
    await secure.setItem('k', first);

    let writes = 0;
    const realSet = store.set.bind(store);
    const failing = (key: string, value: string) => {
      writes += 1;
      if (writes === 2) throw new Error('secure store said no');
      realSet(key, value);
    };
    vi.spyOn(store, 'set').mockImplementation(failing as never);

    await expect(secure.setItem('k', 'B'.repeat(CHUNK_SIZE * 3))).rejects.toThrow();
    vi.restoreAllMocks();

    // The old session is still there and still whole.
    expect(await secure.getItem('k')).toBe(first);
  });
});

describe('web, where storage is allowed to refuse', () => {
  it('round-trips through localStorage', () => {
    web.setItem('k', 'value');

    expect(web.getItem('k')).toBe('value');
  });

  it('reads as signed-out when the browser throws and nothing was written', () => {
    // Private mode, or site data blocked. `localStorage` throws on access
    // rather than returning null, and an unhandled throw here takes down the
    // auth client on a browser that is merely private.
    vi.spyOn(globalThis.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(web.getItem('refused-and-never-written')).toBeNull();
    vi.restoreAllMocks();
  });

  it('keeps the session readable when the write is refused', () => {
    /**
     * The failure this exists for, and it is not "does not throw".
     *
     * `supabase-js` keeps no session of its own — `getSession()` reads back
     * through this adapter. So a `setItem` that swallows the error and stores
     * nothing means sign-in appears to succeed and the next request goes out
     * with the anon key instead. An earlier version did exactly that, and said
     * in a comment that the session stayed in memory. Nothing was keeping it
     * there.
     */
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    web.setItem('quota-key', 'the.session');

    expect(web.getItem('quota-key')).toBe('the.session');
    vi.restoreAllMocks();
  });

  it('does not resurrect a session another tab signed out', () => {
    /**
     * The mirror must never answer a *successful* `null`. Another tab signing
     * out clears the shared `localStorage` and Supabase broadcasts `SIGNED_OUT`,
     * but nothing reaches this module's private Map — so answering from it
     * would keep authenticating with a JWT somebody deliberately threw away,
     * for the rest of its lifetime.
     */
    web.setItem('shared-key', 'the.session');
    globalThis.localStorage.removeItem('shared-key'); // the other tab

    expect(web.getItem('shared-key')).toBeNull();
  });

  it('forgets it again on sign-out', () => {
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    web.setItem('quota-key-2', 'the.session');
    vi.restoreAllMocks();

    web.removeItem('quota-key-2');

    // A mirror that outlived the sign-out would answer for somebody who left.
    expect(web.getItem('quota-key-2')).toBeNull();
  });
});
