import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the session lives, per platform (architecture §10).
 *
 * `supabase-js` wants three async methods and no opinion about the rest. The
 * opinions worth having are about what each platform does to what we store.
 *
 * **Web: `localStorage`, and it is not durable.** Safari's storage policy
 * evicts script-written storage after seven days without interaction with the
 * site, and a browser in private mode, or with site data blocked, throws on the
 * first access rather than returning null. Neither is a bug to be fixed here —
 * they are the reason Continue-as exists (§10). So every access is wrapped, a
 * failure reads as "no session", and the app self-heals onto the reattachment
 * flow instead of showing a broken screen. Anything that treats a session as
 * permanent is wrong on the platform most guests arrive on.
 *
 * **Native: `expo-secure-store`, and it has a size limit.** Android's
 * `EncryptedSharedPreferences` refuses values over 2048 bytes, and a Supabase
 * session — two JWTs, a user object with metadata — goes past that routinely
 * once a profile has anything in it. It does not fail on sign-in; it fails on
 * the *next* sign-in, after the user object grows, which is the kind of bug
 * that reaches a store build. So values are split across numbered keys and
 * rejoined on read.
 */

/**
 * Well under Android's 2048-**byte** ceiling, leaving room for the key itself.
 *
 * Bytes, not characters, and the difference is not academic: a session carries
 * `user_metadata`, which carries whatever an SSO provider says somebody is
 * called. A name in Greek, Japanese or Arabic is two to four UTF-8 bytes per
 * character, so 1536 characters can be 4608 bytes and the write is refused —
 * on the accounts of people whose names are not ASCII, and nobody else's.
 */
const CHUNK_BYTES = 1536;

const encoder = new TextEncoder();

/**
 * Splits on character boundaries while counting bytes.
 *
 * `Array.from` iterates code points rather than UTF-16 units, so a surrogate
 * pair — every emoji, and much of CJK beyond the basic plane — is never cut in
 * half. Slicing by `.length` can put one half in one chunk and the other in the
 * next, which round-trips through a Map in a test and does not survive a store
 * that encodes to UTF-8.
 */
function chunksOf(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;

  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > CHUNK_BYTES && current !== '') {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * Marks a chunked value and says how many parts to expect.
 *
 * It lives under the caller's own key, so a chunked and an unchunked value are
 * told apart by reading one key rather than by probing for a second. The prefix
 * is deliberately not a plausible JWT or JSON fragment: a stored session that
 * happened to start with it would be misread as a header, and this is the one
 * place where a collision loses somebody's session silently.
 */
const CHUNKED = '\u0000circles.chunked:';

/**
 * Web: `localStorage`, mirrored in memory.
 *
 * The mirror is not a nicety. `supabase-js` keeps **no** session of its own —
 * every `getSession()` reads back through this adapter — so a `setItem` that
 * quietly does nothing means sign-in appears to work and the very next request
 * goes out with the anon key. An earlier version of this file swallowed the
 * write and claimed in a comment that "the session stays in memory for this
 * tab". Nothing was keeping it there; that comment was the bug.
 *
 * So writes go to memory always and to `localStorage` when it will have them,
 * and reads prefer `localStorage` and fall back. A private window or blocked
 * site data then costs durability across reloads — which Continue-as already
 * exists to repair — rather than costing the session in front of the person.
 */
const memory = new Map<string, string>();

/**
 * The keys whose durable write we know failed.
 *
 * The mirror is consulted **only** for these, and that is the whole of its
 * correctness. A successful read returning `null` is an answer — another tab
 * signed out, or the person cleared site data — and answering it from memory
 * would resurrect a JWT that had been deliberately thrown away and go on
 * authenticating with it until it expired. Supabase broadcasts `SIGNED_OUT`
 * between tabs; it cannot reach into this module's private Map.
 *
 * Per key rather than a single "storage is broken" flag, because that flag is
 * sticky: one quota failure would mask every later sign-out on every other key,
 * for the life of the page. A key we wrote successfully is a key whose absence
 * we believe.
 */
const unwritable = new Set<string>();

/**
 * Another tab changed this origin's storage, so our copy is no longer the
 * newest thing anybody knows.
 *
 * Without this, the two rules above fight. Preferring the mirror for a key we
 * failed to write is right for a token refresh — the durable copy is stale.
 * It is wrong for a sign-out in another tab: Supabase broadcasts `SIGNED_OUT`
 * over a BroadcastChannel and never calls this adapter, so the durable key goes
 * `null` while we keep answering with a JWT and stay authenticated until
 * reload. A read-time heuristic cannot tell those apart; the `storage` event
 * can, because it fires in *this* tab precisely when another one wrote.
 *
 * `event.key === null` means somebody called `clear()`.
 */
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('storage', (event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === undefined) {
      memory.clear();
      unwritable.clear();
      return;
    }
    memory.delete(key);
    unwritable.delete(key);
  });
}

const webStorage = {
  getItem(key: string): string | null {
    let stored: string | null;
    try {
      stored = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      // Not an answer: the browser is refusing to hold anything at all, and
      // then the mirror is the only session there is.
      return memory.get(key) ?? null;
    }
    /**
     * A key whose durable write we know failed is a key whose durable value we
     * know is **stale**, not merely absent.
     *
     * Checking `stored !== null` first was wrong for the case that matters
     * most: `supabase-js` rewrites the session on every token refresh, so a
     * refused write leaves the *previous* session sitting in `localStorage`
     * with a refresh token that has just been spent. Returning it would sign
     * the person out roughly an hour after the one failed write.
     */
    if (unwritable.has(key)) return memory.get(key) ?? stored;
    return stored;
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
      // It is durable again — a quota that freed up, or site data re-allowed.
      unwritable.delete(key);
    } catch {
      // Out of quota, or storage denied. The mirror above is the session now.
      unwritable.add(key);
    }
  },
  removeItem(key: string): void {
    // Both, and memory first: a sign-out that cleared only the durable copy
    // would leave the mirror answering for somebody who has left.
    memory.delete(key);
    unwritable.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Already unreachable.
    }
  },
};

/**
 * Native. Chunked, because Android refuses a value over 2048 bytes — and
 * generational, because the alternative loses sessions.
 *
 * The obvious implementation clears the old value and then writes the new one.
 * That is fine right up until a write fails or the process is killed between
 * the two, at which point the *previous* refresh token — which was valid — is
 * gone and the person is signed out on next launch. Token refresh happens
 * roughly hourly, so "rare" here still means regularly, across a user base.
 *
 * So each write goes to a fresh generation, the header that names it is written
 * last, and only then is the previous generation deleted. The header is the
 * single atomic switch: until it lands, a reader still sees the whole old
 * value; after it lands, the whole new one. Nothing ever reads a mixture.
 */
type Generation = 'a' | 'b';

interface Header {
  count: number;
  generation: Generation;
}

function chunkKey(key: string, generation: Generation, index: number): string {
  return `${key}.${generation}.${index}`;
}

function parseHeader(raw: string): Header | undefined {
  if (!raw.startsWith(CHUNKED)) return undefined;
  const [count, generation] = raw.slice(CHUNKED.length).split(':');
  const parsed = Number.parseInt(count ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  if (generation !== 'a' && generation !== 'b') return undefined;
  return { count: parsed, generation };
}

async function readHeader(key: string): Promise<Header | undefined> {
  const raw = await SecureStore.getItemAsync(key);
  return raw === null ? undefined : parseHeader(raw);
}

async function deleteGeneration(key: string, header: Header): Promise<void> {
  for (let index = 0; index < header.count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, header.generation, index));
  }
}

/**
 * One write at a time.
 *
 * The generational scheme is safe against *interruption* and not against
 * *overlap*: two writers both read the same header, both pick the generation it
 * does not name, and both write into it. The reader then joins chunks from two
 * different sessions, `supabase-js` fails `_isValidSession`, and the person is
 * signed out. Reproduced with two concurrent `setItem`s of three and two chunks.
 *
 * It is reachable because `supabase-js` uses a no-op lock on native: an
 * auto-refresh tick landing while `verifyOtp` saves, or two resumed claims
 * writing at once. Serialising in this module is the narrow fix — the races are
 * all inside one JavaScript process, so a promise chain is a real lock here,
 * and it leaves the on-disk format alone.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  // Keep the chain alive even when a write rejects, or one failure would
  // deadlock every write after it.
  writes = next.catch(() => undefined);
  return next;
}

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const raw = await SecureStore.getItemAsync(key);
    if (raw === null) return null;

    const header = parseHeader(raw);
    // Not a header: a value small enough to have been stored whole.
    if (header === undefined) return raw;

    const parts: string[] = [];
    for (let index = 0; index < header.count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, header.generation, index));
      // A missing part means the header is pointing at a generation that is not
      // all there — which this write order is designed to make impossible, so
      // treat it as absent rather than hand `supabase-js` unparseable JSON.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    return await serialise(() => secureStorage.write(key, value));
  },

  async removeItem(key: string): Promise<void> {
    return await serialise(() => secureStorage.erase(key));
  },

  /** The body of `setItem`, run under the queue above. */
  async write(key: string, value: string): Promise<void> {
    const previous = await readHeader(key);
    // The generation the current header does *not* name, so writing it cannot
    // touch anything a concurrent reader is reading.
    const generation: Generation = previous?.generation === 'a' ? 'b' : 'a';

    const parts = chunksOf(value);
    if (parts.length <= 1) {
      await SecureStore.setItemAsync(key, value);
    } else {
      for (const [index, part] of parts.entries()) {
        await SecureStore.setItemAsync(chunkKey(key, generation, index), part);
      }
      // The switch. Everything above is invisible until this line lands.
      await SecureStore.setItemAsync(key, `${CHUNKED}${parts.length}:${generation}`);
    }

    // Only now, with the new value committed, is the old one safe to drop.
    if (previous !== undefined) await deleteGeneration(key, previous);
  },

  /** The body of `removeItem`, run under the queue above. */
  async erase(key: string): Promise<void> {
    const header = await readHeader(key);
    if (header !== undefined) await deleteGeneration(key, header);
    // Both generations: a write interrupted before its header landed leaves
    // orphans in the generation no header names, and those are session
    // fragments sitting in secure storage on a device somebody has signed out of.
    for (const generation of ['a', 'b'] as const) {
      for (let index = 0; index < 64; index += 1) {
        await SecureStore.deleteItemAsync(chunkKey(key, generation, index));
      }
    }
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * The adapter `createClient` is given.
 *
 * Typed structurally rather than against `SupportedStorage`, which
 * `supabase-js` does not export from its entry point; the shape is the
 * contract, and `client.ts` fails to compile if it drifts.
 */
export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export const sessionStorage: SessionStorage = Platform.OS === 'web' ? webStorage : secureStorage;

/** Exported for the tests, which need to exercise both sides on one platform. */
export const storageForTests = {
  web: webStorage,
  secure: secureStorage,
  CHUNK_BYTES,
  CHUNKED,
  chunksOf,
};
