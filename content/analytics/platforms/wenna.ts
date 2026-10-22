/**
 * Wenna itself, read for the one number no platform reports: what happened
 * after the tap. A keyed export of the founder screen's funnel by `?from=` tag
 * (ADR 0087, docs/analytics-plan.md "The Wenna export"): the `content-funnel`
 * Edge Function answers a POST of `{ since }` under `CONTENT_FUNNEL_SECRET`
 * with circles made, plans shared, answered and confirmed per tag, and the
 * first plans from content that stalled, counts and ages and nothing finer.
 *
 * Not a PlatformModule: it has no posts, replies or account, only a funnel.
 * The pull (pull.ts) calls it once a night when both variables are set and
 * says "not configured" when either is not.
 *
 * Off until configured. The secret goes in one header and nowhere else: not in
 * a log line, an error or `raw`. The answer is kept as returned.
 */
import { redact } from './http.ts';
import { env as realEnv } from './module.ts';

export type Env = (k: string) => string | undefined;

/** A tag's block of the export, as `SourceRefNumbers` in packages/contracts. */
export type TagBlock = { counters?: Record<string, number>; events?: Record<string, number> };

/** A stalled first plan group, as `StalledRow` in packages/contracts. */
export type StalledGroup = {
  week: string;
  cohort: string;
  source: string;
  state: string;
  circles: number;
  oldest_hours: number;
  median_hours: number;
};

export type FunnelExport = { since: string; by_source_ref: Record<string, TagBlock>; stalled: StalledGroup[] };

/** One tag on one night in funnel.jsonl; `raw` is the tag's block whole. */
export type FunnelRow = {
  date: string;
  at: string;
  from: string;
  circles: number;
  plans_shared: number;
  answered: number;
  confirmed: number;
  raw: TagBlock;
};

/** The night's stalled first plans from content, in funnel.jsonl beside the tags (it has `stalled` and no `from`). */
export type StalledRow = { date: string; at: string; stalled: StalledGroup[] };

export function configured(env: Env = realEnv): { ok: true; url: string; secret: string } | { ok: false; reason: string } {
  const url = env('WENNA_FUNNEL_URL');
  const secret = env('CONTENT_FUNNEL_SECRET');
  const missing = [url ? '' : 'WENNA_FUNNEL_URL', secret ? '' : 'CONTENT_FUNNEL_SECRET'].filter(Boolean);
  return missing.length ? { ok: false, reason: `${missing.join(', ')} unset` } : { ok: true, url: url!, secret: secret! };
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** A malformed answer is a failure, not a night of zeros: nothing is written from it. */
export function parseExport(body: unknown): FunnelExport {
  const b = body as Partial<FunnelExport> | null;
  if (!b || typeof b !== 'object' || typeof b.since !== 'string' || !b.by_source_ref || typeof b.by_source_ref !== 'object' || !Array.isArray(b.stalled)) {
    throw new Error('wenna: the funnel export was not { since, by_source_ref, stalled }');
  }
  return { since: b.since, by_source_ref: b.by_source_ref, stalled: b.stalled };
}

/** POST `{ since }` with the bearer. One try: a failure is printed by the pull and the night is skipped. */
export async function fetchFunnel(opts: { url: string; secret: string; since: string; fetch?: typeof fetch }): Promise<FunnelExport> {
  const res = await (opts.fetch ?? fetch)(opts.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ since: opts.since }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`wenna: ${res.status} ${redact(text).slice(0, 200)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('wenna: the funnel export was not JSON');
  }
  return parseExport(body);
}

/**
 * Circles made is the `circles_created` counter; plans shared, answered and
 * confirmed are the `plan_shared`, `availability_submitted` and
 * `meetup_confirmed` event totals the export carries per tag. A missing number is
 * zero: the export leaves out what did not happen.
 */
export function rowsOf(x: FunnelExport, date: string, at: string): { tags: FunnelRow[]; stalled: StalledRow } {
  const tags = Object.entries(x.by_source_ref)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, block]) => ({
      date,
      at,
      from,
      circles: count(block.counters?.circles_created),
      plans_shared: count(block.events?.plan_shared),
      answered: count(block.events?.availability_submitted),
      confirmed: count(block.events?.meetup_confirmed),
      raw: block,
    }));
  return { tags, stalled: { date, at, stalled: x.stalled } };
}
