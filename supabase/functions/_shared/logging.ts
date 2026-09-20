/**
 * Structured logs with nothing in them that belongs to anybody.
 *
 * Non-negotiable 8, and §14's "structured, PII-free; request id only". The
 * defence here is the *shape*: a log line is built from a fixed set of fields
 * rather than from a template, so there is no interpolation site for a name or
 * an address to end up in. Anything a caller sent stays out by construction,
 * not by everybody remembering.
 */

export interface LogFields {
  /** The function, e.g. `redeem-invite`. */
  fn: string;
  /** The request id, which identifies the request and not the person. */
  request_id: string;
  /** What happened: `handled`, `refused`, `failed`, `replayed`, `throttled`. */
  event: string;
  status?: number | undefined;
  /** A `ProblemReason`, which is an enum and therefore safe. */
  reason?: string | undefined;
  duration_ms?: number | undefined;
  /**
   * The email contact a line is about, by id — never the address (S1-19). An
   * id identifies a row, and a row is only reachable by the service role.
   */
  contact_id?: string | undefined;
}

export function log(level: 'info' | 'warn' | 'error', fields: LogFields): void {
  // `console` is the Edge Function log sink. One line, one JSON object.
  const line = JSON.stringify({ level, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
