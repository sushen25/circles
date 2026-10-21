/**
 * What the scorecard compares, over the pieces' day-7 lifts: groups by
 * family, shape, archetype, posting hour and weekday, each split by platform
 * (a group by platform alone would be the platform median over itself, a
 * lift of 1 every time, so there is none); the feature
 * splits; and the control arm. Splits, not regressions (docs/analytics-plan.md,
 * "Content features"). Every aggregate carries its n, the count of distinct
 * pieces in it, and nothing with n under MIN_N is ranked: it is listed under
 * "too early" and nowhere else. Medians, never means.
 */
import type { Platform } from '../lib/queue.ts';
import type { FeatureRow } from '../lib/measure.ts';
import type { PieceScore } from './scorecard.ts';

/** The fewest pieces an aggregate needs before it is ranked or said to lead. */
export const MIN_N = 3;

export type Side = { label: string; n: number; median_lift: number | null };

export type Group = {
  dimension: 'family' | 'shape' | 'archetype' | 'hour' | 'weekday';
  value: string;
  n: number;
  median_lift: number | null;
  ranked: boolean;
  by_platform: Partial<Record<Platform, { n: number; median_lift: number | null; ranked: boolean }>>;
};

export type Split = {
  name: string;
  yes: Side;
  no: Side;
  /** the larger of the two sides' median absolute deviations */
  spread: number | null;
  /** both sides at MIN_N or more, and the gap between them wider than the spread within them */
  reportable: boolean;
};

export type Aggregates = {
  groups: Group[];
  splits: Split[];
  /** the experiments.md comparison of story-first shapes with demo-first, while its row is live */
  control?: { story_first: Side; demo_first: Side; ranked: boolean };
  too_early: string[];
};

type Entry = { piece: PieceScore; f?: FeatureRow; lift: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

function med(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

function mad(xs: number[]): number | null {
  const m = med(xs);
  return m === null ? null : med(xs.map((x) => Math.abs(x - m)));
}

const distinct = (es: Entry[]) => new Set(es.map((e) => e.piece.slug)).size;

const side = (label: string, es: Entry[]): Side => ({ label, n: distinct(es), median_lift: med(es.map((e) => e.lift)) });

/** The Melbourne time the post went out on its platform, or the piece's planned time when the ledger has none. */
const when = (e: Entry) => e.f?.posted[e.piece.platform] ?? e.f?.publish_at;

const DIMENSIONS: Record<Group['dimension'], (e: Entry) => string | undefined> = {
  family: (e) => e.piece.family,
  shape: (e) => e.piece.shape,
  archetype: (e) => e.piece.archetype,
  hour: (e) => {
    const h = when(e)?.hour;
    return h === undefined ? undefined : `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  },
  weekday: (e) => when(e)?.weekday,
};

/** Each split: a name read as a yes/no question about one piece on one platform; undefined when the piece cannot say. */
export const SPLITS: { name: string; test: (e: Entry) => boolean | undefined }[] = [
  { name: 'total under 28 s', test: (e) => (e.f?.timing ? e.f.timing.total < 28 : undefined) },
  { name: 'two chats or fewer before the beat', test: (e) => (e.f ? e.f.chats_before_beat <= 2 : undefined) },
  { name: 'hook with a number', test: (e) => e.f?.hook.number },
  { name: 'hook is a quote', test: (e) => e.f?.hook.quote },
  { name: 'hook names a time', test: (e) => e.f?.hook.time },
  { name: 'caption ends in a question', test: (e) => e.f?.platforms[e.piece.platform]?.question },
  { name: 'caption carries the link', test: (e) => e.f?.platforms[e.piece.platform]?.link },
  { name: 'posted before 7 pm Melbourne', test: (e) => (when(e) ? when(e)!.hour < 19 : undefined) },
  { name: 'a caption aside on a slide', test: (e) => (e.f ? e.f.captions > 0 : undefined) },
  { name: 'a skip slide', test: (e) => e.f?.skip },
];

/** Whether experiments.md still has a live row (no Result yet) that names demo-first as its control. */
export function controlLive(experiments: string): boolean {
  const rows = experiments.split('\n').filter((l) => l.trim().startsWith('|'));
  const header = rows[0]?.split('|').map((c) => c.trim().toLowerCase());
  const result = header?.indexOf('result') ?? -1;
  return rows.slice(2).some((l) => {
    const cells = l.split('|').map((c) => c.trim());
    return /demo-first/i.test(l) && (result < 0 || !cells[result]);
  });
}

export function aggregate(pieces: PieceScore[], features: Map<string, FeatureRow>, experiments: string): Aggregates {
  const entries: Entry[] = pieces.filter((p) => p.lift !== undefined).map((p) => ({ piece: p, f: features.get(p.slug), lift: p.lift! }));
  const too_early: string[] = [];

  const groups: Group[] = [];
  for (const [dimension, key] of Object.entries(DIMENSIONS) as [Group['dimension'], (e: Entry) => string | undefined][]) {
    const by = new Map<string, Entry[]>();
    for (const e of entries) {
      const v = key(e);
      if (v) by.set(v, [...(by.get(v) ?? []), e]);
    }
    for (const [value, es] of by) {
      const n = distinct(es);
      const by_platform: Group['by_platform'] = {};
      for (const p of new Set(es.map((e) => e.piece.platform))) {
        const on = es.filter((e) => e.piece.platform === p);
        by_platform[p] = { n: distinct(on), median_lift: med(on.map((e) => e.lift)), ranked: distinct(on) >= MIN_N };
      }
      groups.push({ dimension, value, n, median_lift: med(es.map((e) => e.lift)), ranked: n >= MIN_N, by_platform });
      if (n < MIN_N) too_early.push(`${dimension} ${value} (n=${n})`);
    }
  }
  groups.sort((a, b) => a.dimension.localeCompare(b.dimension) || Number(b.ranked) - Number(a.ranked) || (b.median_lift ?? 0) - (a.median_lift ?? 0) || a.value.localeCompare(b.value));

  const splits: Split[] = [];
  for (const s of SPLITS) {
    const yes = entries.filter((e) => s.test(e) === true);
    const no = entries.filter((e) => s.test(e) === false);
    if (!yes.length && !no.length) continue;
    const a = side('yes', yes);
    const b = side('no', no);
    const spreads = [mad(yes.map((e) => e.lift)), mad(no.map((e) => e.lift))].filter((x): x is number => x !== null);
    const spread = spreads.length ? Math.max(...spreads) : null;
    const gap = a.median_lift !== null && b.median_lift !== null ? Math.abs(a.median_lift - b.median_lift) : null;
    const reportable = a.n >= MIN_N && b.n >= MIN_N && gap !== null && spread !== null && gap > spread;
    splits.push({ name: s.name, yes: a, no: b, spread, reportable });
    // A side with no piece is no contrast at all, not an early one: it stays in the table and out of "too early".
    if (a.n && b.n && (a.n < MIN_N || b.n < MIN_N)) too_early.push(`${s.name} (n=${a.n} vs ${b.n})`);
  }

  let control: Aggregates['control'];
  if (controlLive(experiments)) {
    const demo = entries.filter((e) => e.piece.shape === 'demo-first');
    const story = entries.filter((e) => e.piece.shape && e.piece.shape !== 'demo-first');
    const d = side('demo-first', demo);
    const st = side('story-first', story);
    control = { story_first: st, demo_first: d, ranked: d.n >= MIN_N && st.n >= MIN_N };
  }

  return { groups, splits, ...(control ? { control } : {}), too_early };
}
