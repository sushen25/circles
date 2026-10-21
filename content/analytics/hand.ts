/**
 * A number somebody typed or read off a screen, appended to hand.jsonl.
 *
 *   npm run hand <platform> <slug> key=value ... [--date YYYY-MM-DD]
 *       [--by hand|transcribed] [--screen <name>] [--captured-at <iso>]
 *       [--points '<json>']
 *
 * This replaces typing into experiments.md: TikTok has no API the loop can
 * read yet, and three Instagram screens exist in no API at all (the plan,
 * "Capture everything"). The scorecard treats a hand row as a snapshot like
 * any other, so the row carries the same date and slug a pulled row would.
 * A screen transcribed by /transcribe adds `--by transcribed`, the screen's
 * name, when the screenshot was taken, and `--points`: a retention curve
 * sampled at tenths, view sources as percentages, the follower split.
 *
 * Keys are free, because a platform may show a number the common names do
 * not have yet; the names in metrics.ts are what the scorecard reads, so
 * the usage text lists them and an unlisted key gets a note, not a refusal.
 * A slug with no queue file is a warning, not an error: a TikTok post may
 * be claimed later with `npm run posted`, and the row waits for it.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTION_LIMIT, type Platform, type QueueItem } from '../lib/queue.ts';
import { METRICS, appendJsonl, dateOf, type HandRow } from './metrics.ts';

export const HAND_PATH = 'analytics/hand.jsonl';
export const PLATFORMS = Object.keys(CAPTION_LIMIT) as Platform[];
const BY = ['hand', 'transcribed'] as const;

export const USAGE = `usage: npm run hand <platform> <slug> key=value ... [--date YYYY-MM-DD] [--by hand|transcribed]
                    [--screen <name>] [--captured-at <iso>] [--points '<json>']

  platform       one of ${PLATFORMS.join(', ')}
  slug           the piece, as in its queue file's frontmatter
  key=value      a number as the app shows it; the common names (metrics.ts) are
                 ${METRICS.join(', ')}
  --date         the day the numbers are for (UTC); today when left out
  --by           hand (typed, the default) or transcribed (read off a screenshot)
  --screen       the screen a transcribed row came from: retention, sources, followers …
  --captured-at  when the screenshot was taken (ISO)
  --points       JSON object of arrays or objects of numbers: a curve at tenths, sources as percentages

  npm run hand tiktok never-lead-anywhere views=1240 saves=18 shares=9`;

export type Deps = {
  /** where the row goes; the tests point it at a temp file */
  path: string;
  findItem: (slug: string) => QueueItem | undefined;
  now: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
};

async function withDefaults(deps: Partial<Deps>): Promise<Deps> {
  const findItem = deps.findItem ?? (await import('./claim.ts')).findItem;
  return { path: HAND_PATH, now: () => new Date(), log: console.log, error: console.error, ...deps, findItem };
}

export type Points = NonNullable<HandRow['points']>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An object whose values are arrays of numbers or objects of numbers, and nothing else. */
export function parsePoints(text: string): Points | string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return `--points is not JSON: ${(e as Error).message}`;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '--points must be a JSON object';
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      if (!val.every(finite)) return `--points "${k}" has a value that is not a finite number`;
    } else if (val && typeof val === 'object') {
      if (!Object.values(val as Record<string, unknown>).every(finite)) return `--points "${k}" has a value that is not a finite number`;
    } else return `--points "${k}" must be an array or an object of numbers`;
  }
  return v as Points;
}

export type Args = {
  platform: Platform;
  slug: string;
  metrics: Record<string, number>;
  date?: string;
  by: HandRow['by'];
  screen?: string;
  captured_at?: string;
  points?: Points;
};

/** Returns a string, the reason, when the call is wrong. */
export function parseArgs(argv: string[]): Args | string {
  const positional: string[] = [];
  const metrics: Record<string, number> = {};
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!['date', 'by', 'screen', 'captured-at', 'points'].includes(name)) return `unknown flag ${a}`;
      const v = argv[++i];
      if (v === undefined) return `${a} needs a value`;
      flags[name] = v;
    } else if (a.includes('=')) {
      const eq = a.indexOf('=');
      const key = a.slice(0, eq).trim();
      const raw = a.slice(eq + 1).trim();
      const n = raw === '' ? NaN : Number(raw.replace(/,/g, ''));
      if (!key) return `"${a}" has no key`;
      if (!Number.isFinite(n)) return `${key}=${raw}: "${raw}" is not a number`;
      metrics[key] = n;
    } else positional.push(a);
  }
  if (positional.length !== 2) return 'expected <platform> <slug> then key=value pairs';
  const [platform, slug] = positional;
  if (!PLATFORMS.includes(platform as Platform)) return `"${platform}" is not a platform; one of ${PLATFORMS.join(', ')}`;
  if (flags.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) return `--date "${flags.date}" is not YYYY-MM-DD`;
  if (flags.date !== undefined && Number.isNaN(Date.parse(flags.date))) return `--date "${flags.date}" is not a date`;
  const by = (flags.by ?? 'hand') as HandRow['by'];
  if (!BY.includes(by)) return `--by "${flags.by}" is not one of ${BY.join(', ')}`;
  if (flags['captured-at'] !== undefined && Number.isNaN(Date.parse(flags['captured-at']))) return `--captured-at "${flags['captured-at']}" is not a date`;
  let points: Points | undefined;
  if (flags.points !== undefined) {
    const p = parsePoints(flags.points);
    if (typeof p === 'string') return p;
    points = p;
  }
  if (!Object.keys(metrics).length && !points) return 'nothing to record: give at least one key=value, or --points';
  return {
    platform: platform as Platform,
    slug,
    metrics,
    date: flags.date,
    by,
    screen: flags.screen,
    captured_at: flags['captured-at'] === undefined ? undefined : new Date(flags['captured-at']).toISOString(),
    points,
  };
}

/** Exit code: 0 appended, 2 a wrong call. */
export async function run(argv: string[], deps: Partial<Deps> = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const d = await withDefaults(deps);
  if (typeof parsed === 'string') {
    d.error(`${parsed}\n\n${USAGE}`);
    return 2;
  }
  const { platform, slug, metrics, by, screen, captured_at, points } = parsed;

  const item = d.findItem(slug);
  if (!item) d.log(`warn  no queue or published file has slug "${slug}"; recording it anyway (claim the post with npm run posted when it exists)`);
  const unlisted = Object.keys(metrics).filter((k) => !(METRICS as readonly string[]).includes(k));
  if (unlisted.length) d.log(`note  not a common name in metrics.ts, so the scorecard will not read it: ${unlisted.join(', ')}`);

  const now = d.now();
  const row: HandRow = {
    date: parsed.date ?? dateOf(now),
    at: now.toISOString(),
    slug: item?.fm.slug ?? slug,
    platform,
    metrics,
    by,
    ...(screen !== undefined ? { screen } : {}),
    ...(captured_at !== undefined ? { captured_at } : {}),
    ...(points !== undefined ? { points } : {}),
  };
  appendJsonl(d.path, row);
  d.log(`hand  ${platform} ${row.slug} → ${d.path}`);
  d.log(`      ${JSON.stringify(row)}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
