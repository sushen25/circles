/**
 * Where a draft answer is kept on this device (S1-25, S3-01a): a small
 * key–value port, so `drafts.ts` states the rules once and each platform
 * supplies only the storage.
 *
 * `draftStore.ts` is the web's; `draftStore.native.ts` the app's, which Metro
 * picks on iOS and Android by extension. A draft is not a secret — it is the
 * times somebody painted — so it has no business in the session's chunked
 * secure store, whose every write is an encrypted multi-key transaction.
 */
export interface DraftStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** This key only. Never a sweep: a sweep is the session's sign-out erase. */
  remove(key: string): void;
  /**
   * How long a burst of writes is held to become one, in ms. Zero writes each
   * straight through: `localStorage` is synchronous and a reload a click away,
   * so a held write on the web is a painted cell lost to F5.
   */
  coalesceMs: number;
}
