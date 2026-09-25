import { sessionStorage } from '../auth/storage';
import type { DraftStore } from './draftStorePort';

/**
 * The web's draft store: `localStorage`, through the same adapter the session
 * uses there, which already mirrors in memory when the browser refuses to hold
 * anything (private windows, blocked site data). On the web that adapter is
 * synchronous; the cast is to the web half of its type.
 *
 * Native builds never load this file: Metro resolves `draftStore.native.ts`.
 */
const web = sessionStorage as {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const draftStore: DraftStore = {
  get: (key) => web.getItem(key),
  set: (key, value) => web.setItem(key, value),
  remove: (key) => web.removeItem(key),
  coalesceMs: 0,
};
