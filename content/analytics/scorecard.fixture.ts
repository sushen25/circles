/**
 * Six pieces for the scorecard and brief tests (the phase-2 "done when"):
 * three `pm` pieces in the quote-led shape that do well on Instagram, two
 * `skit` pieces that do badly, one `rhythm` demo-first control. Instagram
 * has all six at day 7, Bluesky four; TikTok one, typed by hand. Every
 * number is chosen so the lifts are easy to check by eye: Instagram views
 * are 1,000, so saves+shares per thousand is saves+shares.
 */
import type { FeatureRow } from '../lib/measure.ts';
import type { Ledger } from '../publish/guards.ts';
import type { Platform } from '../lib/queue.ts';
import type { AccountRow, HandRow, Metrics, PostRow, SeriesRow } from './metrics.ts';
import type { Inputs } from './scorecard.ts';

export const NOW = new Date('2026-11-18T05:00:00Z');
const DAY = 86_400_000;

type Piece = { slug: string; family: string; shape: string; archetype: string; postedDaysAgo: number; hour: number; number: boolean; total: number; ig: number; bs?: number };

export const PIECES: Piece[] = [
  { slug: 'pm-one', family: 'pm', shape: 'quote-led', archetype: 'quote', postedDaysAgo: 20, hour: 18, number: true, total: 26, ig: 30, bs: 4 },
  { slug: 'pm-two', family: 'pm', shape: 'quote-led', archetype: 'count', postedDaysAgo: 18, hour: 18, number: true, total: 27, ig: 40, bs: 6 },
  { slug: 'pm-three', family: 'pm', shape: 'quote-led', archetype: 'quote', postedDaysAgo: 16, hour: 18, number: true, total: 25, ig: 35, bs: 5 },
  { slug: 'skit-one', family: 'skit', shape: 'skit', archetype: 'plain', postedDaysAgo: 14, hour: 20, number: false, total: 30, ig: 10, bs: 1 },
  { slug: 'skit-two', family: 'skit', shape: 'skit', archetype: 'plain', postedDaysAgo: 12, hour: 20, number: false, total: 31, ig: 12 },
  { slug: 'rhythm-one', family: 'rhythm', shape: 'demo-first', archetype: 'role', postedDaysAgo: 10, hour: 20, number: false, total: 29, ig: 5 },
];

const iso = (ms: number) => new Date(ms).toISOString();
/** Melbourne is UTC+11 in November. */
const postedAt = (p: Piece) => {
  const d = new Date(NOW.getTime() - p.postedDaysAgo * DAY);
  d.setUTCHours(p.hour - 11, 0, 0, 0);
  return d.toISOString();
};

function post(p: Piece, platform: Platform, age: number, metrics: Metrics): PostRow {
  const at = Date.parse(postedAt(p)) + age * DAY;
  return { date: iso(at).slice(0, 10), at: iso(at), slug: p.slug, family: p.family, platform, id: `${platform}-${p.slug}`, from: `x-${p.slug}`, posted_at: postedAt(p), age_days: age, metrics, raw: {} };
}

export function feature(p: Piece): FeatureRow {
  const when = { hour: p.hour, weekday: 'Tue' };
  return {
    slug: p.slug,
    at: postedAt(p),
    family: p.family,
    shape: p.shape,
    archetype: p.archetype,
    hook: { text: `${p.slug.replace('-', ' ')} hook line`, words: 4, number: p.number, quote: p.archetype === 'quote', time: false },
    slides: 7,
    components: {},
    chats_before_beat: 2,
    messages: { total: 8, per_chat: [4, 4], median_len: 20 },
    when_stamps: 2,
    skip: false,
    slow_pace: [],
    captions: 0,
    cast: 4,
    screens: { availability: true, locked: true, compare: false, grid: false },
    platforms: { instagram: { length: 80, sentences: 2, question: p.number, link: false, hashtags: 3 } },
    publish_at: when,
    posted: { instagram: when, bluesky: when },
    timing: { total: p.total, before: 16, after: 8, slides: [3, 5, 5, 3, 4, 4, p.total - 24] },
  };
}

export function inputs(): Inputs {
  const posts: PostRow[] = [];
  for (const p of PIECES) {
    // nightly snapshots: a missed night at day 7 for pm-two, so its day 7 is read at 7.9
    for (const age of p.slug === 'pm-two' ? [0.6, 1.4, 3.2, 7.9, 14.1] : [0.6, 1.1, 3.05, 7.02, 14.3]) {
      if (age > p.postedDaysAgo) continue;
      const grow = Math.min(age / 7, 1);
      posts.push(post(p, 'instagram', age, { views: Math.round(1000 * grow), saves: Math.round(p.ig * grow * 0.6), shares: Math.round(p.ig * grow * 0.4), likes: Math.round(50 * grow) }));
      if (p.bs !== undefined) posts.push(post(p, 'bluesky', age, { replies: age >= 7 ? p.bs : 0, reposts: 0, quotes: 0, likes: 3 }));
    }
  }
  const series: SeriesRow[] = [2, 4, 6, 8, 12, 24, 48].map((h) => ({
    ...post(PIECES[5], 'instagram', h / 24, { views: h <= 6 ? h * 50 : 300 + (h - 6) * 5 }),
    age_hours: h,
  }));
  const hand: HandRow[] = [
    { date: '2026-11-11', at: iso(Date.parse(postedAt(PIECES[0])) + 7.5 * DAY), slug: 'pm-one', platform: 'tiktok', metrics: { views: 2000, saves: 20, shares: 10 }, by: 'hand' },
    {
      date: '2026-11-01',
      at: postedAt(PIECES[0]),
      slug: 'pm-one',
      platform: 'instagram',
      metrics: { skip_pct: 45.5 },
      by: 'transcribed',
      screen: 'retention',
      points: { retention: { '0.0': 100, '0.5': 40, '1.0': 12 }, sources: { reels_tab: 57.1, profile: 28.6, feed: 14.3 } },
    },
  ];
  const account: AccountRow[] = [
    { date: '2026-11-16', at: iso(NOW.getTime() - DAY), platform: 'instagram', metrics: { followers: 40 }, breakdowns: {}, raw: {} },
    { date: '2026-11-17', at: NOW.toISOString(), platform: 'instagram', metrics: { followers: 42, reach: 300 }, breakdowns: { reach_by_follow_type: { FOLLOWER: 60, NON_FOLLOWER: 240 } }, raw: {} },
  ];
  const ledger: Ledger = PIECES.map((p) => ({ date: postedAt(p).slice(0, 10), platform: 'instagram', slug: p.slug, id: `instagram-${p.slug}`, at: postedAt(p), kind: 'posted' as const }));
  ledger.push({ date: '', platform: 'tiktok', slug: 'pm-one', id: 'draft', at: postedAt(PIECES[0]), kind: 'drafted' });
  ledger.push({ date: '', platform: 'tiktok', slug: 'pm-one', id: '73', at: postedAt(PIECES[0]), kind: 'posted', by: 'hand' });
  return {
    posts,
    series,
    hand,
    account,
    features: PIECES.map(feature),
    ledger,
    replies: [
      { slug: 'pm-one', platform: 'bluesky', text: 'ha, pm one hook line, every time' },
      { slug: 'pm-one', platform: 'bluesky', text: 'so true' },
    ],
    experiments: [
      '| Fortnight | Family | Shape | Hypothesis | Result | Next |',
      '|---|---|---|---|---|---|',
      '| 2026-11-03 → 11-16 | skit | skit (demo-first as the control) | story beats demo | | |',
    ].join('\n'),
  };
}
