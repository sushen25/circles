/**
 * The contract every platform module keeps (docs/analytics-plan.md, "Pull").
 * One file per platform in this folder, the way publish/adapters.ts is one
 * thin function per platform. The pull, `npm run posted` and `npm run tokens`
 * know a platform only through this interface.
 *
 * Rules a module keeps, because nothing downstream can check them:
 *
 * - **Off until configured.** `configured()` names what is missing; the pull
 *   skips the platform and says so. No call is made while it says no.
 * - **Counts and text, never people.** `replies()` drops the author before
 *   returning and drops the account's own replies; `account()` returns
 *   bucketed counts only. No follower list, no DM, no username anywhere.
 * - **Raw kept whole.** Every call's JSON, as returned, goes in `raw`; the
 *   module maps what it recognises into the common names and never trims.
 * - **No secret in any error or log line.** Use `platforms/http.ts`, which
 *   redacts tokens from URLs and bodies before it throws.
 * - **One try.** No retries beyond what http.ts does; the pull prints a
 *   failure and the other platforms continue.
 */
import type { Platform } from '../../lib/queue.ts';
import type { Metrics, Reply } from '../metrics.ts';

export type Configured = { ok: true } | { ok: false; reason: string };

/** A post's numbers: the common names, and every response whole. */
export type Fetched = { metrics: Metrics; raw: unknown };

/** The account's numbers for one day: flat metrics, named breakdowns, every response whole. */
export type AccountFetched = {
  metrics: Record<string, number>;
  breakdowns: Record<string, Record<string, number>>;
  raw: unknown;
};

/** A recent post on the account, for auto-claim: `text` holds whatever carries the link (caption, description). */
export type RecentPost = { id: string; at: string; text: string };

export type TokenState = {
  platform: Platform;
  /** every credential the module needs is set */
  configured: boolean;
  /** what is missing, or what the token can and cannot do */
  note?: string;
  /** ISO date the token expires, when known */
  expires?: string;
  daysLeft?: number;
  /** OAuth scopes the token carries, when the platform can say */
  scopes?: string[];
};

export interface PlatformModule {
  platform: Platform;
  /** Synchronous, from process.env: what is missing, if anything. */
  configured(): Configured;
  /** Tier 1: the post's numbers, mapped and raw. Throws on a platform failure. */
  metrics(id: string): Promise<Fetched>;
  /** Replies on the post, author dropped, the account's own replies dropped. `since` is an ISO time; older replies may be skipped. */
  replies(id: string, since?: string): Promise<Reply[]>;
  /** Tier 2: the account on `day` (YYYY-MM-DD, UTC). Absent when the platform offers nothing. */
  account?(day: string): Promise<AccountFetched>;
  /** The account's recent posts, newest first, for auto-claim by tag. Absent when the platform offers nothing. */
  recent?(): Promise<RecentPost[]>;
  /** The post's own publish time, ISO, for a hand post's ledger row. */
  postedAt?(id: string): Promise<string | undefined>;
  /** Turn a pasted URL (or an id) into the id the ledger holds. Throws when it cannot. */
  parseId?(urlOrId: string): Promise<string>;
  /** For `npm run tokens`: what the credentials can do and when they expire. Never prints a secret. */
  token?(): Promise<TokenState>;
}

/** Read one env var; `undefined` when unset or blank. */
export const env = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

/** The usual `configured()` body: the first missing key names the reason. */
export function needs(...keys: string[]): Configured {
  const missing = keys.filter((k) => !env(k));
  return missing.length ? { ok: false, reason: `${missing.join(', ')} unset` } : { ok: true };
}
