import { z } from 'zod';

/**
 * `export-my-data` — the caller's own data as JSON (spec §13; S4-05, ADR 0083).
 *
 * A POST with no body that matters and **no idempotency key**: the answer is
 * the person's data, and the kit records an answer against its key for seven
 * days, which would keep a copy of the export in a table. The client turns the
 * answer into a download; nothing is stored here.
 *
 * Only the caller's own rows come back, and no other member's name, id or
 * address. One a day: `too_many_requests` after that.
 */
export const ExportMyDataRequest = z.object({});
export type ExportMyDataRequest = z.infer<typeof ExportMyDataRequest>;

export const ExportMyDataResponse = z.object({
  ok: z.literal(true),
  /** A name for the file, dated: `wenna-my-data-2026-10-20.json`. */
  filename: z.string().regex(/^[a-z0-9-]+\.json$/),
  data: z.record(z.string(), z.unknown()),
});
export type ExportMyDataResponse = z.infer<typeof ExportMyDataResponse>;
