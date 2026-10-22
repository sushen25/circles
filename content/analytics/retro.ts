/**
 * `npm run retro`: the numbers for one fortnight's rows of experiments.md,
 * from analytics/scorecard.json (docs/analytics-plan.md, "Retro"). The
 * script fills the number cells; a person, or `/retro` through a PR, writes
 * Result and Next. It never writes a Result.
 *
 *   npm run retro                                # the last fortnight that has ended
 *   npm run retro -- --fortnight 2026-10-20      # the rows that start that day, ended or not
 *   npm run retro -- --write                     # and put the cells into experiments.md
 *
 * A row is keyed by its first two cells, Fortnight and Family. Its pieces
 * are that family's pieces whose first post (the ledger's, Melbourne day)
 * falls inside the fortnight. The cells:
 *
 * - Pieces: how many.
 * - Views (TikTok): the sum of their latest TikTok views, with n; blank when
 *   no TikTok number was recorded. Never guessed.
 * - Saves+shares /1k: the median day-7 rate per platform, with n; "too
 *   early" when no piece is seven days old; "not measured" when some are,
 *   but only on platforms ranked on another rate (Bluesky).
 * - Circles made, Plans shared: from the Wenna export (phase 3); blank until
 *   then, rather than guessed.
 *
 * `--write` changes those five cells in the fortnight's rows and nothing
 * else. A row it cannot rebuild cell for cell (a cell count that differs
 * from the header's) is refused, naming the line, before anything is
 * written.
 *
 * It also prints, for every family in the fortnight whose day 30 falls
 * before the next retro, the day-7 lift ranking the standing rule (kill the
 * two worst, double the best) is applied to; the rule is `/retro`'s
 * proposal, never this script's.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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
import { dashDashNote, restoreSwallowed, type Env } from './argv.ts';

const COLUMNS = ['Pieces', 'Views (TikTok)', 'Saves+shares /1k', 'Circles made', 'Plans shared'] as const;
type Column = (typeof COLUMNS)[number];

export type Row = { line: number; cells: string[]; start: string; end: string; family: string };
export type Table = { header: string[]; rows: Row[]; eol: string };

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * "2026-10-20 → 11-02" (or with the year on both ends) as two ISO days. The cell must start with it: a struck-out
 * `~~…~~` row is not a fortnight. The end takes the start's year, or the next one across new year, and must fall after
 * the start.
 */
export function parseFortnight(cell: string): { start: string; end: string } | undefined {
  const m = cell.match(/^(\d{4})-(\d{2})-(\d{2})\s*(?:→|->|–)\s*(?:(\d{4})-)?(\d{2})-(\d{2})(?!\d)/);
  if (!m) return undefined;
  const [, y, mo, d, y2, mo2, d2] = m;
  const endYear = y2 ?? String(Number(mo2) < Number(mo) ? Number(y) + 1 : Number(y));
  const start = `${y}-${mo}-${d}`;
  const end = `${endYear}-${mo2}-${d2}`;
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || end <= start) return undefined;
  return { start, end };
}

/** A table row's cells. A pipe escaped as `\|` or inside a `code span` is part of its cell, as markdown renders it. */
export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (ch === '`') {
      code = !code;
      cur += ch;
    } else if (ch === '|' && !code) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** A family cell as a name: `**pm**` and `pm` are the same family. */
const familyName = (cell: string) => cell.replace(/[*_`~]/g, '').trim();

/** The experiments table: its header and every data row with a fortnight that reads. */
export function parseTable(md: string): Table {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\|\s*Fortnight\s*\|/i.test(l));
  if (at < 0) throw new Error('experiments.md has no table with a Fortnight column');
  const header = splitRow(lines[at]);
  const missing = COLUMNS.filter((c) => !header.some((h) => h.toLowerCase() === c.toLowerCase()));
  if (missing.length === COLUMNS.length) throw new Error(`experiments.md's table has none of the columns this fills (${COLUMNS.join(', ')})`);
  const rows: Row[] = [];
  for (let i = at + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i]);
    const f = parseFortnight(cells[0] ?? '');
    if (f) rows.push({ line: i, cells, ...f, family: familyName(cells[1] ?? '') });
  }
  return { header, rows, eol };
}

/**
 * The fortnight asked for (ended or not), or the latest that has ended by `today`. Nothing ended is an answer of its
 * own, not the running fortnight: a row filled mid-fortnight would read as its result.
 */
export function pickFortnight(t: Table, today: string, asked?: string): { start?: string; why?: string } {
  if (asked) return t.rows.some((r) => r.start === asked) ? { start: asked } : { why: `no experiments.md row starts on ${asked}` };
  const ended = t.rows.filter((r) => r.end < today).map((r) => r.start).sort();
  if (ended.length) return { start: ended.at(-1) };
  const running = t.rows.filter((r) => r.start <= today).map((r) => r.start).sort().at(-1);
  return { why: `no fortnight has ended by ${today}${running ? `; ${running} is still running (--fortnight ${running} fills it early)` : ''}` };
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
  let rate = '';
  if (per.size) {
    rate = [...per]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, xs]) => `${PLATFORM_PREFIX[p]} ${fmt(median(xs))} (n=${xs.length})`)
      .join(', ');
  } else if (slugs.length) {
    rate = pieces.some((p) => p.day7 !== undefined) ? 'not measured' : 'too early';
  }

  return { Pieces: String(slugs.length), 'Views (TikTok)': views, 'Saves+shares /1k': rate, 'Circles made': '', 'Plans shared': '' };
}

/** The row with its number cells filled and every other cell (Hypothesis, Result, Next …) exactly as it was. */
export function fillRow(header: string[], row: Row, cells: Record<Column, string>): string {
  if (row.cells.length !== header.length) {
    throw new Error(`experiments.md line ${row.line + 1} has ${row.cells.length} cells where the header has ${header.length}; fix the row (a pipe inside a cell is written \\|) before --write`);
  }
  const out = header.map((h, i) => {
    const col = COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
    return col ? cells[col] : row.cells[i];
  });
  return `| ${out.join(' | ')} |`;
}

/**
 * The families in this fortnight whose day 30 (counted from the first row they appear in, that row's start as day 1)
 * falls before the next retro, the morning after the next fortnight ends: the last retro that can act on it is this one.
 */
export function day30(t: Table, card: Scorecard, start: string, end: string): string[] {
  const first = new Map<string, string>();
  for (const r of t.rows) if (!first.has(r.family) || first.get(r.family)! > r.start) first.set(r.family, r.start);
  const live = new Set(t.rows.filter((r) => r.start === start).map((r) => r.family));
  const nextRetro = addDays(end, 15);
  const due = [...live].filter((f) => days(first.get(f)!, nextRetro) >= 30).sort();
  if (!due.length) return [];
  const lines = due.map((f) => {
    const g = card.groups.find((x) => x.dimension === 'family' && x.value === f);
    if (!g) return `- ${f}: no piece seven days old (n=0)`;
    return g.ranked ? `- ${f}: median lift ${fmt(g.median_lift ?? NaN)} (n=${g.n})` : `- ${f}: too early to rank (n=${g.n}, needs ${MIN_N})`;
  });
  const when = due.map((f) => `${f} ${addDays(first.get(f)!, 29)}`).join(', ');
  return [`Day 30 before the next retro (${when}). Day-7 lift by family:`, ...lines];
}

export function retro(opts: { experiments: string; card: Scorecard; features: FeatureRow[]; ledger: Ledger; today: string; fortnight?: string }) {
  const t = parseTable(opts.experiments);
  const pick = pickFortnight(t, opts.today, opts.fortnight);
  if (!pick.start) throw new Error(pick.why);
  const start = pick.start;
  const rows = t.rows.filter((r) => r.start === start);
  const end = rows.map((r) => r.end).sort().at(-1)!;
  const features = latestFeatures(opts.features);
  // Every row is rebuilt before any is written, so a row that cannot be rebuilt leaves the file as it was.
  const filled = rows.map((r) => ({ row: r, text: fillRow(t.header, r, cellsFor(r, opts.card, features, opts.ledger)) }));
  const lines = opts.experiments.split(/\r?\n/);
  for (const f of filled) lines[f.row.line] = f.text;
  return {
    start,
    end,
    ended: end < opts.today,
    rows: filled.map((f) => f.text),
    updated: lines.join(t.eol),
    day30: day30(t, opts.card, start, end),
  };
}

/** The command line, after the flags npm swallowed are put back: --fortnight needs a date, --write is bare. */
export function parseArgs(argv: string[], env: Env): { fortnight?: string; write: boolean; note?: string } {
  const { argv: full, restored } = restoreSwallowed(argv, [{ name: 'fortnight' }, { name: 'write', boolean: true }], env);
  let fortnight: string | undefined;
  let write = false;
  for (let i = 0; i < full.length; i++) {
    const a = full[i];
    if (a === '--write') write = true;
    else if (a === '--fortnight') {
      const v = full[++i];
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('--fortnight needs the day a row starts, e.g. --fortnight 2026-10-20');
      fortnight = v;
    } else throw new Error(`not an option: ${a} (usage: npm run retro -- [--fortnight <start>] [--write])`);
  }
  return { fortnight, write, ...(restored.length ? { note: dashDashNote(restored) } : {}) };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (args.note) console.log(args.note);
  if (!existsSync('analytics/scorecard.json')) throw new Error('no analytics/scorecard.json: run npm run scorecard first');
  const experiments = readFileSync('experiments.md', 'utf8');
  const today = melbourneDate(new Date());
  const r = retro({
    experiments,
    card: JSON.parse(readFileSync('analytics/scorecard.json', 'utf8')) as Scorecard,
    features: readJsonl<FeatureRow>('analytics/features.jsonl'),
    ledger: readLedger('publish/ledger.jsonl'),
    today,
    fortnight: args.fortnight,
  });
  console.log(`Fortnight ${r.start} → ${r.end}${r.ended ? '' : `, still running on ${today}: these are not its results`}\n`);
  for (const row of r.rows) console.log(row);
  if (r.day30.length) console.log(`\n${r.day30.join('\n')}`);
  if (args.write) {
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
