/**
 * One definition per metric (docs/analytics-plan.md, "Principles"). The
 * pull, the scorecard, the brief and the retro all read this file and
 * nothing else defines a rate.
 *
 * A platform module (analytics/platforms/*) maps what its API returns into
 * the common names below and keeps the API's answer whole beside them as
 * `raw`, so a renamed metric never loses history. Likes are stored and
 * shown; `like_rate` is never ranked.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Platform } from '../lib/queue.ts';

/** The common per-post metric names. Counts unless the name says otherwise. */
export const METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'replies',
  'shares',
  'saves',
  'reposts',
  'quotes',
  'watch_avg_s',
  'watch_total_s',
  'watch_pct',
  'skip_pct',
  'engaged_views',
] as const;
export type Metric = (typeof METRICS)[number];
export type Metrics = Partial<Record<Metric, number>>;

/** One line of analytics/posts.jsonl: a post's numbers on one night. */
export type PostRow = {
  /** YYYY-MM-DD (UTC) of the pull */
  date: string;
  /** ISO time of the pull */
  at: string;
  slug: string;
  family: string;
  platform: Platform;
  /** the platform's post id, as the ledger holds it */
  id: string;
  /** the link tag the post carried (lib/links.ts) */
  from: string;
  /** ISO time the post went out: the ledger's `at`, or the platform's own time for a hand post */
  posted_at: string;
  /** (at - posted_at) in days, two decimals; what the scorecard aligns on */
  age_days: number;
  metrics: Metrics;
  /** exactly what the platform returned, every call's JSON, never trimmed */
  raw: unknown;
};

/** One line of analytics/series.jsonl: the same, every two hours for the first 48 hours. */
export type SeriesRow = PostRow & { age_hours: number };

/** One line of analytics/account.jsonl: the account itself, one row per platform per day. */
export type AccountRow = {
  /** YYYY-MM-DD (UTC) the numbers describe: the day before the pull, the last whole one */
  date: string;
  /** ISO time of the pull */
  at: string;
  platform: Platform;
  /** flat numbers: followers, reach, views, likes, comments, shares, saves, link_taps, accounts_engaged, follows, unfollows … */
  metrics: Record<string, number>;
  /** named splits, each a map of bucket → count: reach_by_follow_type, views_by_surface, follower_age, follower_country … */
  breakdowns: Record<string, Record<string, number>>;
  raw: unknown;
};

/** One line of analytics/hand.jsonl: a number somebody typed or read off a screen. */
export type HandRow = {
  date: string;
  at: string;
  slug: string;
  platform: Platform;
  metrics: Record<string, number>;
  by: 'hand' | 'transcribed';
  /** a transcribed screen's name (retention, sources, followers …) */
  screen?: string;
  /** when the screenshot was taken, ISO, as the person says */
  captured_at?: string;
  /** a retention curve sampled at tenths, view sources as percentages, the follower split … */
  points?: Record<string, number[] | Record<string, number>>;
};

/** A reply as a platform module returns it: the author is dropped before it leaves the module. */
export type Reply = { id: string; at: string; text: string };

/** The ages, in days, that posts are compared at. Never "current against current". */
export const AGES = [1, 3, 7, 14] as const;
export type Age = (typeof AGES)[number];

/** Hours a post is polled for the views-over-time curve. */
export const SERIES_HOURS = 48;

/** Days before a Meta token's expiry at which the nightly run fails loudly. */
export const TOKEN_WARN_DAYS = 7;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export function ageDays(postedAt: string, at: Date): number {
  return round((at.getTime() - Date.parse(postedAt)) / 86_400_000, 2);
}

export function ageHours(postedAt: string, at: Date): number {
  return round((at.getTime() - Date.parse(postedAt)) / 3_600_000, 2);
}

export const dateOf = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * The rates the scorecard ranks, derived from stored counts. Every rate
 * Instagram shows under "What affects your views" is a count over views.
 * `like_rate` is here so it can be shown, and it is in UNRANKED so it never
 * decides anything. Bluesky has no views, so its number is `engagement`
 * (replies + reposts + quotes), a per-post count.
 */
export type Rates = {
  saves_shares_per_k?: number;
  comments_per_k?: number;
  share_rate?: number;
  save_rate?: number;
  comment_rate?: number;
  like_rate?: number;
  repost_rate?: number;
  engagement?: number;
  watch_pct?: number;
  skip_pct?: number;
};
export const RATES = [
  'saves_shares_per_k',
  'comments_per_k',
  'share_rate',
  'save_rate',
  'comment_rate',
  'like_rate',
  'repost_rate',
  'engagement',
  'watch_pct',
  'skip_pct',
] as const satisfies readonly (keyof Rates)[];
/** Listed, never ranked. */
export const UNRANKED: ReadonlySet<keyof Rates> = new Set(['like_rate']);
/** The one rate a platform is ranked on, when it has views; Bluesky's is `engagement`. */
export const HEADLINE: Record<Platform, keyof Rates> = {
  instagram: 'saves_shares_per_k',
  youtube: 'saves_shares_per_k',
  tiktok: 'saves_shares_per_k',
  threads: 'saves_shares_per_k',
  linkedin: 'saves_shares_per_k',
  reddit: 'comments_per_k',
  bluesky: 'engagement',
};

/** `lengthS` is the piece's measured length (features.jsonl), for watch_pct when the platform gives only an average watch time. */
export function rates(m: Metrics, platform: Platform, lengthS?: number): Rates {
  const r: Rates = {};
  const views = m.views;
  const has = (k: Metric) => typeof m[k] === 'number';
  if (views && views > 0) {
    if (has('saves') || has('shares')) r.saves_shares_per_k = round(((m.saves ?? 0) + (m.shares ?? 0)) / views * 1000, 2);
    if (has('comments') || has('replies')) r.comments_per_k = round(((m.comments ?? 0) + (m.replies ?? 0)) / views * 1000, 2);
    if (has('shares')) r.share_rate = round((m.shares ?? 0) / views, 4);
    if (has('saves')) r.save_rate = round((m.saves ?? 0) / views, 4);
    if (has('comments')) r.comment_rate = round((m.comments ?? 0) / views, 4);
    if (has('likes')) r.like_rate = round((m.likes ?? 0) / views, 4);
    if (has('reposts')) r.repost_rate = round((m.reposts ?? 0) / views, 4);
  }
  if (platform === 'bluesky' || !views) {
    if (has('replies') || has('reposts') || has('quotes')) r.engagement = (m.replies ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0);
  }
  if (has('watch_pct')) r.watch_pct = m.watch_pct;
  else if (has('watch_avg_s') && lengthS && lengthS > 0) r.watch_pct = round(((m.watch_avg_s ?? 0) / lengthS) * 100, 1);
  if (has('skip_pct')) r.skip_pct = m.skip_pct;
  return r;
}

/**
 * Nothing that names a person leaves a module or reaches the repo: @handles,
 * u/names and links become a mark, in place, so the sentence still reads.
 */
export function stripHandles(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/(^|[^\w/])@[\w.-]+/g, '$1@…')
    .replace(/(^|[^\w/])u\/[\w-]+/g, '$1u/…');
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"'’‘.,!?;:()\[\]…-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/**
 * A reply that quotes the hook back, matched by words, case-insensitively:
 * every word of the hook (three or more of them, or the whole hook when it
 * is shorter) appears in the reply in order. Misses paraphrase, catches
 * coincidence; good enough for a count (plan, open point 5).
 */
export function quotesHook(reply: string, hook: string): boolean {
  const h = words(hook);
  const r = words(reply);
  if (!h.length || !r.length) return false;
  const need = h.length <= 3 ? h : h;
  for (let i = 0; i + need.length <= r.length; i++) {
    if (need.every((w, k) => r[i + k] === w)) return true;
  }
  return false;
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + '\n');
}

/** Days until an ISO date (a Meta token's expiry), floored; negative once past. */
export function daysUntil(isoDate: string, now: Date): number {
  return Math.floor((Date.parse(isoDate) - now.getTime()) / 86_400_000);
}
