/**
 * `npm run retro`: the numbers for one fortnight's rows of experiments.md,
 * from analytics/scorecard.json (docs/analytics-plan.md, "Retro"). The
 * script fills the number cells; a person, or `/retro` through a PR, writes
 * Result and Next. It never writes a Result.
 *
 *   npm run retro                                # the last fortnight that has ended
 *   npm run retro -- --fortnight 2026-10-20      # the rows that start that day
 *   npm run retro -- --write                     # and put the cells into experiments.md
 *
 * A row is keyed by its first two cells, Fortnight and Family. Its pieces
 * are that family's pieces whose first post (the ledger's, Melbourne day)
 * falls inside the fortnight. The cells:
 *
 * - Pieces: how many.
 * - Views (TikTok): the sum of their latest TikTok views, with n; blank when
 *   no TikTok number was recorded. Never guessed.
 * - Saves+shares /1k: the median day-7 rate per platform, with n, or "too
 *   early" when none is seven days old.
 * - Circles made, Plans shared: from the Wenna export (phase 3); blank until
 *   analytics/funnel.jsonl exists, rather than guessed.
 *
 * It also prints, for every family at or past day 30 of its first row, the
 * day-7 lift ranking the standing rule (kill the two worst, double the best)
 * is applied to; the rule is `/retro`'s proposal, never this script's.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from '../lib/queue.ts';
import { PLATFORM_PREFIX } from '../lib/links.ts';
import { melbourneDate, type FeatureRow } from '../lib/measure.ts';
import { readLedger, type Ledger } from '../publish/guards.ts';
import { readJsonl } from './metrics.ts';
import { latestFeatures } from './features.ts';
import { MIN_N } from './aggregates.ts';
import { median, type Scorecard } from './scorecard.ts';

const COLUMNS = ['Pieces', 'Views (TikTok)', 'Saves+shares /1k', 'Circles made', 'Plans shared'] as const;
type Column = (typeof COLUMNS)[number];

export type Row = { line: number; cells: string[]; start: string; end: string; family: string };
export type Table = { header: string[]; rows: Row[] };

/** "2026-10-20 → 11-02" (or with the year on both ends) as two ISO days; the end takes the start's year, or the next one across new year. */
export function parseFortnight(cell: string): { start: string; end: string } | undefined {
  const m = cell.match(/(\d{4})-(\d{2})-(\d{2})\s*(?:→|->|–|-)\s*(?:(\d{4})-)?(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, y2, mo2, d2] = m;
  const endYear = y2 ?? String(Number(mo2) < Number(mo) ? Number(y) + 1 : Number(y));
  return { start: `${y}-${mo}-${d}`, end: `${endYear}-${mo2}-${d2}` };
}

const split = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The experiments table: its header and every data row with a fortnight that reads. */
export function parseTable(md: string): Table {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => /^\|\s*Fortnight\s*\|/i.test(l));
  if (at < 0) throw new Error('experiments.md has no table with a Fortnight column');
  const header = split(lines[at]);
  const rows: Row[] = [];
  for (let i = at + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = split(lines[i]);
    const f = parseFortnight(cells[0] ?? '');
    if (f) rows.push({ line: i, cells, ...f, family: cells[1] ?? '' });
  }
  return { header, rows };
}

/** The fortnight asked for, or the latest that has ended by `today`, or failing that the latest that has started. */
export function pickFortnight(t: Table, today: string, asked?: string): string | undefined {
  if (asked) return t.rows.some((r) => r.start === asked) ? asked : undefined;
  const starts = [...new Set(t.rows.map((r) => r.start))].sort();
  const ended = t.rows.filter((r) => r.end < today).map((r) => r.start).sort();
  return ended.at(-1) ?? starts.filter((s) => s <= today).at(-1);
}

/** Each piece's first post, the Melbourne day, from the ledger: a TikTok draft is not a post. */
function firstPosted(ledger: Ledger): Map<string, string> {
  const by = new Map<string, string>();
  for (const l of ledger) {
    if (l.kind === 'drafted') continue;
    const day = melbourneDate(new Date(l.at));
    if (!by.has(l.slug) || by.get(l.slug)! > day) by.set(l.slug, day);
  }
  return by;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function cellsFor(row: Row, card: Scorecard, features: Map<string, FeatureRow>, ledger: Ledger): Record<Column, string> {
  const posted = firstPosted(ledger);
  const family = (slug: string) => features.get(slug)?.family ?? card.pieces.find((p) => p.slug === slug)?.family;
  const slugs = [...posted]
    .filter(([slug, day]) => day >= row.start && day <= row.end && family(slug) === row.family)
    .map(([slug]) => slug)
    .sort();
  const pieces = card.pieces.filter((p) => slugs.includes(p.slug));

  const tiktok = pieces.filter((p) => p.platform === 'tiktok' && typeof p.latest?.metrics.views === 'number');
  const views = tiktok.length ? `${tiktok.reduce((a, p) => a + p.latest!.metrics.views!, 0)} (n=${tiktok.length})` : '';

  const per = new Map<Platform, number[]>();
  for (const p of pieces) {
    if (p.headline !== 'saves_shares_per_k' || p.day7 === undefined) continue;
    per.set(p.platform, [...(per.get(p.platform) ?? []), p.day7]);
  }
  const rate = per.size
    ? [...per]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, xs]) => `${PLATFORM_PREFIX[p]} ${fmt(median(xs))} (n=${xs.length})`)
        .join(', ')
    : slugs.length
      ? 'too early'
      : '';

  return { Pieces: String(slugs.length), 'Views (TikTok)': views, 'Saves+shares /1k': rate, 'Circles made': '', 'Plans shared': '' };
}

/** The row with its number cells filled and every other cell (Hypothesis, Result, Next …) as it was. */
export function fillRow(header: string[], row: Row, cells: Record<Column, string>): string {
  const out = header.map((h, i) => {
    const col = COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
    return col ? cells[col] : (row.cells[i] ?? '');
  });
  return `| ${out.join(' | ')} |`;
}

/** Families at day 30 or past it by the fortnight's end, counted from the first row they appear in. */
export function day30(t: Table, card: Scorecard, end: string): string[] {
  const first = new Map<string, string>();
  for (const r of t.rows) if (!first.has(r.family) || first.get(r.family)! > r.start) first.set(r.family, r.start);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const due = [...first].filter(([, s]) => days(s, end) >= 29).map(([f]) => f);
  if (!due.length) return [];
  const lines = due.map((f) => {
    const g = card.groups.find((x) => x.dimension === 'family' && x.value === f);
    if (!g) return `- ${f}: no piece seven days old (n=0)`;
    return g.ranked ? `- ${f}: median lift ${fmt(g.median_lift ?? NaN)} (n=${g.n})` : `- ${f}: too early to rank (n=${g.n}, needs ${MIN_N})`;
  });
  return [`Day 30 or past it by ${end} (first row: ${due.map((f) => `${f} ${first.get(f)}`).join(', ')}). Day-7 lift by family:`, ...lines];
}

export function retro(opts: { experiments: string; card: Scorecard; features: FeatureRow[]; ledger: Ledger; today: string; fortnight?: string }) {
  const t = parseTable(opts.experiments);
  const start = pickFortnight(t, opts.today, opts.fortnight);
  if (!start) throw new Error(opts.fortnight ? `no experiments.md row starts on ${opts.fortnight}` : 'experiments.md has no fortnight that has started');
  const rows = t.rows.filter((r) => r.start === start);
  const features = latestFeatures(opts.features);
  const filled = rows.map((r) => ({ row: r, text: fillRow(t.header, r, cellsFor(r, opts.card, features, opts.ledger)) }));
  const lines = opts.experiments.split('\n');
  for (const f of filled) lines[f.row.line] = f.text;
  return { start, end: rows[0].end, rows: filled.map((f) => f.text), updated: lines.join('\n'), day30: day30(t, opts.card, rows[0].end) };
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--fortnight');
  const fortnight = i >= 0 ? args[i + 1] : process.env.npm_config_fortnight;
  const write = args.includes('--write') || process.env.npm_config_write === 'true';
  if (!existsSync('analytics/scorecard.json')) throw new Error('no analytics/scorecard.json: run npm run scorecard first');
  const experiments = readFileSync('experiments.md', 'utf8');
  const r = retro({
    experiments,
    card: JSON.parse(readFileSync('analytics/scorecard.json', 'utf8')) as Scorecard,
    features: readJsonl<FeatureRow>('analytics/features.jsonl'),
    ledger: readLedger('publish/ledger.jsonl'),
    today: melbourneDate(new Date()),
    fortnight,
  });
  console.log(`Fortnight ${r.start} → ${r.end}\n`);
  for (const row of r.rows) console.log(row);
  if (r.day30.length) console.log(`\n${r.day30.join('\n')}`);
  if (write) {
    writeFileSync('experiments.md', r.updated);
    console.log(`\nwrote ${r.rows.length} row${r.rows.length === 1 ? '' : 's'} into experiments.md`);
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && fileURLToPath(import.meta.url) === entry) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
