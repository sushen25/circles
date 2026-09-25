import { createMMKV } from 'react-native-mmkv';

import type { DraftStore } from './draftStorePort';

/**
 * The app's draft store: MMKV (architecture §2, §9), in an instance of its own
 * so nothing else's keys share a file with somebody's painted week.
 *
 * Synchronous and memory-mapped, so a write costs microseconds; what a paint
 * costs is the `JSON.stringify` of the draft, which is why a drag's writes are
 * still held for a moment and written once (`drafts.ts`). Unencrypted on
 * purpose: a draft is not a secret, and the session's secure store — where
 * drafts lived until S3-01a — made every paint a multi-chunk encrypted write
 * and every clear the session's 128-key sign-out erase (S1-25's note).
 */
const mmkv = createMMKV({ id: 'circles.answer-drafts' });

export const draftStore: DraftStore = {
  get: (key) => mmkv.getString(key) ?? null,
  set: (key, value) => mmkv.set(key, value),
  remove: (key) => {
    mmkv.remove(key);
  },
  coalesceMs: 250,
};
