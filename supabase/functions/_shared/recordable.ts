import { FORBIDDEN_PAYLOAD_KEYS } from '@circles/contracts';

/**
 * Whether the database will take an analytics row, asked before it is asked
 * (SUS-147).
 *
 * `analytics.events` refuses a payload that `jobs.carries_content` says carries
 * content, by raising, and `record_events` inserts a batch in one statement. So
 * one row the check refuses used to cost the other forty-nine. This is the same
 * rule, applied up front to each row on its own: the database's constraint stays
 * as the backstop, and is no longer the filter.
 *
 * The rule, from `supabase/sql/functions/jobs/carries_content.sql`:
 *
 * - no object key, at any depth, contains a fragment of `FORBIDDEN_PAYLOAD_KEYS`;
 * - every string, at any depth, is 1 to 40 characters of `[A-Za-z0-9_./:+-]`.
 *
 * `recordable.test.ts` holds the two in step on the strings that matter.
 */
const CONTENT_FREE = /^[A-Za-z0-9_./:+-]{1,40}$/;

export function carriesContent(document: unknown): boolean {
  if (typeof document === 'string') return !CONTENT_FREE.test(document);
  if (Array.isArray(document)) return document.some(carriesContent);
  if (typeof document === 'object' && document !== null) {
    return Object.entries(document).some(
      ([key, value]) =>
        FORBIDDEN_PAYLOAD_KEYS.some((fragment) => key.toLowerCase().includes(fragment)) ||
        carriesContent(value),
    );
  }
  return false;
}

/**
 * Keeps the rows the database will accept and counts the rest **by event name
 * only**. The name is the catalogue's (the caller passes what `acceptEvent`
 * returned, never what the client sent), and the count is all that is kept of
 * the payload that failed: nothing it said can reach a log through this.
 */
export function splitRecordable<Row extends { event_name: string; properties: unknown }>(
  rows: readonly Row[],
): { keep: Row[]; dropped: Record<string, number> } {
  const keep: Row[] = [];
  const dropped: Record<string, number> = {};
  for (const row of rows) {
    if (carriesContent(row.properties)) {
      dropped[row.event_name] = (dropped[row.event_name] ?? 0) + 1;
    } else {
      keep.push(row);
    }
  }
  return { keep, dropped };
}
