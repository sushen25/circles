import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storageForTests } from './storage';

/**
 * The session store, on both platforms, from one test run.
 *
 * `storage.ts` picks between them by `Platform.OS`, so exercising the chosen
 * one only ever tests half of it. Both are exported for this reason: the native
 * half is where the interesting failures are, and jsdom is not Android.
 */

const { web, secure, CHUNK_BYTES } = storageForTests;

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
    const session = 'x'.repeat(CHUNK_BYTES * 3 + 17);

    await secure.setItem('k', session);

    expect(await secure.getItem('k')).toBe(session);
  });

  it('reads correctly across a shrink and a re-grow', async () => {
    const long = 'A'.repeat(CHUNK_BYTES * 4);
    const short = 'B'.repeat(CHUNK_BYTES * 2);

    await secure.setItem('k', long);
    await secure.setItem('k', short);
    expect(await secure.getItem('k')).toBe(short);

    await secure.setItem('k', 'C'.repeat(CHUNK_BYTES * 4));
    expect(await secure.getItem('k')).toBe('C'.repeat(CHUNK_BYTES * 4));
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
    await secure.setItem('k', 'A'.repeat(CHUNK_BYTES * 4));
    await secure.setItem('k', 'B'.repeat(CHUNK_BYTES * 2));

    await secure.removeItem('k');

    expect([...store.keys()]).toEqual([]);
  });

  it('reads a half-written value as absent rather than as a truncated session', async () => {
    await secure.setItem('k', 'D'.repeat(CHUNK_BYTES * 3));
    // A partial restore from a backup. The write order makes this unreachable
    // by interruption; it is still what a reader must not misread.
    store.delete('k.a.1');

    // Not the prefix: `supabase-js` would be handed unparseable JSON on every
    // start, and the person would be stuck rather than merely signed out.
    expect(await secure.getItem('k')).toBeNull();
  });

  it('removes every chunk, so nothing is recoverable after a sign-out', async () => {
    await secure.setItem('k', 'E'.repeat(CHUNK_BYTES * 3));

    await secure.removeItem('k');

    expect(store.size).toBe(0);
  });

  it('measures Android\u2019s limit in bytes, not characters', async () => {
    /**
     * A session carries `user_metadata`, which carries whatever an SSO provider
     * says somebody is called. At two to four UTF-8 bytes per character, 1536
     * characters can be 4608 bytes — refused by SecureStore, on the accounts of
     * people whose names are not ASCII and nobody else's.
     */
    const japanese = '\u3042'.repeat(2000); // 3 bytes each: 6000 bytes

    await secure.setItem('k', japanese);

    expect(await secure.getItem('k')).toBe(japanese);
    // Every stored part is inside the ceiling the mock enforces.
    for (const [storedKey, part] of store) {
      if (storedKey === 'k') continue;
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(2048);
    }
  });

  it('never splits a surrogate pair', async () => {
    // Emoji and much of CJK beyond the basic plane are two UTF-16 units. Slicing
    // by `.length` can put one half in one chunk and the other in the next.
    const emoji = '\u{1F642}'.repeat(1000);

    await secure.setItem('k', emoji);

    expect(await secure.getItem('k')).toBe(emoji);
    for (const [storedKey, part] of store) {
      if (storedKey === 'k') continue;
      // A lone surrogate survives a Map and not a store that encodes to UTF-8.
      expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(part).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });

  it('does not interleave two writes that overlap', async () => {
    /**
     * Reproduced before the fix: both writers read the same header, both pick
     * the generation it does not name, and both write into it — so a reader
     * joins chunks from two different sessions, `supabase-js` fails
     * `_isValidSession`, and the person is signed out. Reachable because
     * `supabase-js` uses a no-op lock on native, so an auto-refresh tick can
     * land while `verifyOtp` is saving.
     */
    const first = 'A'.repeat(CHUNK_BYTES * 3);
    const second = 'B'.repeat(CHUNK_BYTES * 2);

    await Promise.all([secure.setItem('k', first), secure.setItem('k', second)]);

    // Whichever landed last, it is one of them and not a blend of both.
    expect([first, second]).toContain(await secure.getItem('k'));
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
    const first = 'A'.repeat(CHUNK_BYTES * 3);
    await secure.setItem('k', first);

    let writes = 0;
    const realSet = store.set.bind(store);
    const failing = (key: string, value: string) => {
      writes += 1;
      if (writes === 2) throw new Error('secure store said no');
      realSet(key, value);
    };
    vi.spyOn(store, 'set').mockImplementation(failing as never);

    await expect(secure.setItem('k', 'B'.repeat(CHUNK_BYTES * 3))).rejects.toThrow();
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

  it('prefers the fresh copy when the durable one is known to be stale', () => {
    /**
     * The refresh case, which is the common one: `supabase-js` rewrites the
     * session hourly. A write refused once leaves the *previous* session in
     * `localStorage` with a refresh token that has just been spent — so
     * answering from durable storage because it is non-null signs the person
     * out about an hour later, from one transient failure.
     */
    web.setItem('rotating', 'session.v1');

    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    web.setItem('rotating', 'session.v2');
    vi.restoreAllMocks();

    expect(web.getItem('rotating')).toBe('session.v2');
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

  it('drops the mirror when another tab changes that key', () => {
    /**
     * The tension this resolves. Preferring the mirror for a key we failed to
     * write is right for a token refresh — the durable copy is stale. It is
     * wrong for a sign-out in another tab, where Supabase broadcasts over a
     * BroadcastChannel and never calls this adapter: the durable key goes null
     * while we keep answering with a JWT. A read cannot tell the two apart; the
     * `storage` event fires in this tab exactly when another one wrote.
     */
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    web.setItem('cross-tab', 'the.session');
    vi.restoreAllMocks();
    expect(web.getItem('cross-tab')).toBe('the.session');

    // The other tab signs out.
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'cross-tab', newValue: null }));

    expect(web.getItem('cross-tab')).toBeNull();
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
