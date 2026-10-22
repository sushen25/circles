/**
 * analytics/features.jsonl: what each published piece is, one row per piece
 * (lib/measure.ts), written by the nightly pull with no browser. A piece
 * gains a row the first night it has a post id, and a new one only when its
 * measure changes: a platform's post time arriving in the ledger, or the
 * `timing:` block the video build writes. The scorecard reads the last row
 * per slug, so history is kept and nothing is rewritten.
 */
import type { QueueItem } from '../lib/queue.ts';
import { measure, sameFeatures, type FeatureRow, type LedgerLine } from '../lib/measure.ts';
import { appendJsonl, readJsonl } from './metrics.ts';

/** The last row per slug: the piece as it is measured now. */
export function latestFeatures(rows: FeatureRow[]): Map<string, FeatureRow> {
  const by = new Map<string, FeatureRow>();
  for (const r of rows) by.set(r.slug, r);
  return by;
}

export function writeFeatures(opts: {
  items: QueueItem[];
  ledger: LedgerLine[];
  path: string;
  now: Date;
  dry: boolean;
  log: (line: string) => void;
}): { written: number; failures: number } {
  const have = latestFeatures(readJsonl<FeatureRow>(opts.path));
  let written = 0;
  let failures = 0;
  for (const item of opts.items) {
    if (!Object.keys(item.fm.published ?? {}).length || !item.skit) continue;
    let row: FeatureRow;
    try {
      row = measure(item, opts.ledger, opts.now);
    } catch (e) {
      failures++;
      opts.log(`FAIL  features ${item.fm.slug}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const prev = have.get(row.slug);
    if (prev && sameFeatures(prev, row)) continue;
    if (opts.dry) opts.log(`dry   would append features ${row.slug} to ${opts.path}`);
    else appendJsonl(opts.path, row);
    written++;
    opts.log(`feat  ${row.slug}${prev ? ' (changed)' : ''}${row.timing ? ` ${row.timing.total}s` : ' (no timing yet)'}`);
  }
  return { written, failures };
}
