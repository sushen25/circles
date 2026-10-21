/**
 * `npm run scorecard`: the joined, age-matched tables (docs/analytics-plan.md,
 * "Scorecard"). Reads posts, series, hand, account and features from
 * analytics/, the replies in inbox/ and experiments.md; writes
 * analytics/scorecard.json and analytics/scorecard.md. Pure from its inputs:
 * `buildScorecard` takes the rows and the time, so a fixture set is the
 * test and the same numbers come out every time.
 *
 * Per piece per platform, at ages 1, 3, 7 and 14 days, the first snapshot at
 * or after that age (and before the next one, so a missed night costs a
 * day's precision, never a row, and a day-1 number is never read off day 9).
 * Rates come from metrics.ts and nowhere else. Each piece's day-7 headline
 * rate over the platform's median at day 7 is its lift; lift is what every
 * aggregate (aggregates.ts) compares, so platforms are never pooled.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from '../lib/queue.ts';
import { melbourneDate, type FeatureRow } from '../lib/measure.ts';
import { readLedger, type Ledger } from '../publish/guards.ts';
import {
  AGES,
  HEADLINE,
  ageDays,
  quotesHook,
  rates,
  readJsonl,
  type AccountRow,
  type Age,
  type HandRow,
  type Metrics,
  type PostRow,
  type Rates,
  type SeriesRow,
} from './metrics.ts';
import { latestFeatures } from './features.ts';
import { aggregate, type Aggregates } from './aggregates.ts';
import { renderScorecard } from './scorecard-md.ts';

export type Snapshot = { age_days: number; source: 'pull' | 'hand' | 'transcribed'; metrics: Metrics; rates: Rates };

export type PieceScore = {
  slug: string;
  platform: Platform;
  family: string;
  shape?: string;
  archetype?: string;
  /** keyed by age in days ("1", "3", "7", "14") */
  ages: Partial<Record<`${Age}`, Snapshot>>;
  /** the newest snapshot, whatever its age: what a piece younger than a day shows */
  latest?: Snapshot;
  /** the rate this platform is ranked on (metrics.ts HEADLINE) */
  headline: keyof Rates;
  day7?: number;
  /** day7 over the platform's median at day 7 */
  lift?: number;
  /** views at 2, 6, 12, 24 and 48 hours from series.jsonl, and the hour the curve bent */
  first48?: { views: Partial<Record<string, number>>; bent_at_h?: number };
  /** transcribed screens beside the pull: the retention curve against the slide on screen, the view sources */
  screens: { screen: string; by: string; captured_at?: string; retention?: { tenth: string; pct: number; slide?: number }[]; sources?: Record<string, number> }[];
  replies: number;
  hook_quotes: number;
};

export type AccountLine = { platform: Platform; date: string; text: string };

export type Scorecard = {
  /** ISO time of the run */
  generated: string;
  /** the Melbourne day of the run, which both files are dated by */
  day: string;
  pieces: PieceScore[];
  /** each platform's median headline rate at day 7, and over how many pieces */
  medians: Partial<Record<Platform, { rate: keyof Rates; median: number; n: number }>>;
  account: AccountLine[];
} & Aggregates;

export type Inputs = {
  posts: PostRow[];
  series: SeriesRow[];
  hand: HandRow[];
  account: AccountRow[];
  features: FeatureRow[];
  ledger: Ledger;
  /** reply texts by piece and platform, from inbox/ */
  replies: { slug: string; platform: Platform; text: string }[];
  /** experiments.md as text, for the control arm */
  experiments: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The first snapshot at or after `age` and before the next age compared (day 14's window runs a week). */
export function atAge<T extends { age_days: number }>(rows: T[], age: Age): T | undefined {
  const i = AGES.indexOf(age);
  const until = AGES[i + 1] ?? age + 7;
  return [...rows].sort((a, b) => a.age_days - b.age_days).find((r) => r.age_days >= age && r.age_days < until);
}

const HOURS = [2, 6, 12, 24, 48];

/** Views at the fixed hours, and the first hour after the steepest stretch at which views came at under half that pace. */
export function first48(rows: SeriesRow[]): PieceScore['first48'] {
  const s = rows.filter((r) => typeof r.metrics.views === 'number').sort((a, b) => a.age_hours - b.age_hours);
  if (!s.length) return undefined;
  const views: Record<string, number> = {};
  HOURS.forEach((h, i) => {
    const until = HOURS[i + 1] ?? h + 6;
    const hit = s.find((r) => r.age_hours >= h && r.age_hours < until);
    if (hit) views[`h${h}`] = hit.metrics.views!;
  });
  const pace = s.slice(1).map((r, i) => ({ at: r.age_hours, v: (r.metrics.views! - s[i].metrics.views!) / Math.max(r.age_hours - s[i].age_hours, 0.01) }));
  let bent_at_h: number | undefined;
  if (pace.length >= 3) {
    const peak = pace.reduce((best, p, i) => (p.v > pace[best].v ? i : best), 0);
    const after = pace.slice(peak + 1).find((p) => p.v < pace[peak].v / 2);
    if (pace[peak].v > 0 && after) bent_at_h = r2(after.at);
  }
  return { views, ...(bent_at_h !== undefined ? { bent_at_h } : {}) };
}

/** Which slide is on screen at each tenth of the video, from the measured slide seconds. */
function slideAt(tenth: number, timing: FeatureRow['timing']): number | undefined {
  if (!timing?.slides.length) return undefined;
  const t = tenth * timing.total;
  let end = 0;
  for (let i = 0; i < timing.slides.length; i++) {
    end += timing.slides[i];
    if (t < end) return i + 1;
  }
  return timing.slides.length;
}

function postedAt(ledger: Ledger, slug: string, platform: Platform): string | undefined {
  return ledger.find((l) => l.slug === slug && l.platform === platform && l.kind !== 'drafted')?.at;
}

export function buildScorecard(input: Inputs, now: Date): Scorecard {
  const features = latestFeatures(input.features);
  const keys = new Map<string, { slug: string; platform: Platform }>();
  for (const r of [...input.posts, ...input.hand]) keys.set(`${r.slug}\u0000${r.platform}`, { slug: r.slug, platform: r.platform });

  const pieces: PieceScore[] = [];
  for (const { slug, platform } of keys.values()) {
    const f = features.get(slug);
    const length = f?.timing?.total;
    const pulled = input.posts.filter((r) => r.slug === slug && r.platform === platform);
    const handRows = input.hand.filter((r) => r.slug === slug && r.platform === platform);
    // A platform the pull reads is scored on the pull; hand numbers stand in only where the pull has nothing (TikTok).
    let snaps: Snapshot[] = pulled.map((r) => ({ age_days: r.age_days, source: 'pull', metrics: r.metrics, rates: rates(r.metrics, platform, length) }));
    if (!snaps.length) {
      const posted = postedAt(input.ledger, slug, platform);
      snaps = posted
        ? handRows
            .filter((r) => Object.keys(r.metrics).length)
            .map((r) => ({ age_days: ageDays(posted, new Date(r.captured_at ?? r.at)), source: r.by, metrics: r.metrics as Metrics, rates: rates(r.metrics as Metrics, platform, length) }))
        : [];
    }
    const ages: PieceScore['ages'] = {};
    for (const a of AGES) {
      const s = atAge(snaps, a);
      if (s) ages[`${a}`] = s;
    }
    const latest = snaps.length ? snaps.reduce((a, b) => (b.age_days > a.age_days ? b : a)) : undefined;
    const headline = HEADLINE[platform];
    const day7 = ages['7']?.rates[headline];
    const screens = handRows
      .filter((r) => r.points)
      .map((r) => {
        const ret = r.points!.retention;
        const retention =
          ret && !Array.isArray(ret)
            ? Object.entries(ret)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([tenth, pct]) => ({ tenth, pct, ...(slideAt(Number(tenth), f?.timing) ? { slide: slideAt(Number(tenth), f?.timing) } : {}) }))
            : undefined;
        const src = r.points!.sources ?? r.points!.traffic;
        return {
          screen: r.screen ?? 'screen',
          by: r.by,
          ...(r.captured_at ? { captured_at: r.captured_at } : {}),
          ...(retention ? { retention } : {}),
          ...(src && !Array.isArray(src) ? { sources: src } : {}),
        };
      });
    const replies = input.replies.filter((r) => r.slug === slug && r.platform === platform);
    const hook = f?.hook.text ?? '';
    const f48 = first48(input.series.filter((r) => r.slug === slug && r.platform === platform));
    pieces.push({
      slug,
      platform,
      family: f?.family ?? pulled[0]?.family ?? 'unknown',
      ...(f?.shape ? { shape: f.shape } : {}),
      ...(f?.archetype ? { archetype: f.archetype } : {}),
      ages,
      ...(latest ? { latest } : {}),
      headline,
      ...(day7 !== undefined ? { day7 } : {}),
      ...(f48 ? { first48: f48 } : {}),
      screens,
      replies: replies.length,
      hook_quotes: hook ? replies.filter((r) => quotesHook(r.text, hook)).length : 0,
    });
  }
  pieces.sort((a, b) => a.slug.localeCompare(b.slug) || a.platform.localeCompare(b.platform));

  const medians: Scorecard['medians'] = {};
  for (const platform of new Set(pieces.map((p) => p.platform))) {
    const xs = pieces.filter((p) => p.platform === platform && p.day7 !== undefined).map((p) => p.day7!);
    if (xs.length) medians[platform] = { rate: HEADLINE[platform], median: r2(median(xs)), n: xs.length };
  }
  for (const p of pieces) {
    const m = medians[p.platform]?.median;
    if (p.day7 !== undefined && m && m > 0) p.lift = r2(p.day7 / m);
  }

  return {
    generated: now.toISOString(),
    day: melbourneDate(now),
    pieces,
    medians,
    account: accountLines(input.account),
    ...aggregate(pieces, features, input.experiments),
  };
}

const fmtSplit = (b: Record<string, number> | undefined) =>
  b && Object.keys(b).length ? Object.entries(b).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ') : undefined;

/** The account by day as context lines, the latest day per platform; never attributed to a post. */
export function accountLines(rows: AccountRow[]): AccountLine[] {
  const latest = new Map<Platform, AccountRow>();
  for (const r of rows) if (!latest.has(r.platform) || latest.get(r.platform)!.date <= r.date) latest.set(r.platform, r);
  return [...latest.values()]
    .sort((a, b) => a.platform.localeCompare(b.platform))
    .map((r) => {
      const parts = ['followers', 'reach', 'views', 'link_taps', 'accounts_engaged'].filter((k) => typeof r.metrics[k] === 'number').map((k) => `${k.replace('_', ' ')} ${r.metrics[k]}`);
      const follow = fmtSplit(r.breakdowns.reach_by_follow_type);
      const surface = fmtSplit(r.breakdowns.views_by_surface);
      if (follow) parts.push(`reach by follow type: ${follow}`);
      if (surface) parts.push(`views by surface: ${surface}`);
      return { platform: r.platform, date: r.date, text: parts.join(' · ') };
    });
}

/** Reply texts from inbox/<date>-replies.md and inbox/done/, by the `## <slug> · <platform>` sections inbox.ts writes. */
export function readReplies(inboxDir: string): Inputs['replies'] {
  const out: Inputs['replies'] = [];
  for (const dir of [inboxDir, join(inboxDir, 'done')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => /-replies\.md$/.test(x))) {
      for (const section of readFileSync(join(dir, f), 'utf8').split(/^## /m).slice(1)) {
        const [head, ...body] = section.split('\n');
        const [slug, platform] = head.split(' · ').map((s) => s.trim());
        if (!slug || !platform) continue;
        for (const block of body.join('\n').split(/\n\s*\n/)) {
          const text = block.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, '')).join('\n').trim();
          if (text) out.push({ slug, platform: platform as Platform, text });
        }
      }
    }
  }
  return out;
}

export function readInputs(dir = 'analytics'): Inputs {
  return {
    posts: readJsonl<PostRow>(join(dir, 'posts.jsonl')),
    series: readJsonl<SeriesRow>(join(dir, 'series.jsonl')),
    hand: readJsonl<HandRow>(join(dir, 'hand.jsonl')),
    account: readJsonl<AccountRow>(join(dir, 'account.jsonl')),
    features: readJsonl<FeatureRow>(join(dir, 'features.jsonl')),
    ledger: readLedger('publish/ledger.jsonl'),
    replies: readReplies('inbox'),
    experiments: existsSync('experiments.md') ? readFileSync('experiments.md', 'utf8') : '',
  };
}

function main(): void {
  const card = buildScorecard(readInputs(), new Date());
  writeFileSync('analytics/scorecard.json', JSON.stringify(card, null, 2) + '\n');
  writeFileSync('analytics/scorecard.md', renderScorecard(card));
  console.log(`scorecard: ${card.pieces.length} piece-platforms, ${card.groups.filter((g) => g.ranked).length} ranked groups → analytics/scorecard.md`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && fileURLToPath(import.meta.url) === entry) main();
