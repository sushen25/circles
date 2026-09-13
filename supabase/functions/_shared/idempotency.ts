import type { IdempotencyKey } from '@circles/contracts';

import type { Db } from './db.ts';
import { sha256Hex } from './hash.ts';
import { Refusal } from './problem.ts';

/**
 * "Every mutation is idempotent on a client-supplied key" (§9.1).
 *
 * The retry being guarded against is the one where the client never saw a
 * response — a phone that lost signal between the request and the answer, which
 * is most of this product's traffic. It cannot tell a timeout from a failure,
 * so it asks again; without this, asking again joins the circle twice.
 *
 * The database does the deciding (`begin_request`); this is the shape of it in
 * TypeScript. Note what happens on `in_flight`: the honest answer is "not
 * finished", not a second attempt at the work.
 */

export interface Replay {
  status: number;
  body: unknown;
}

export async function claim(
  db: Db,
  fn: string,
  userId: string,
  key: IdempotencyKey,
  body: unknown,
  /**
   * Fields that are not part of *what is being asked*.
   *
   * A Turnstile token is a proof of humanity, single-use and fetched fresh on
   * every attempt — so two requests differing only in their token are the same
   * request, and fingerprinting it made every honest retry an
   * `idempotency_mismatch`.
   */
  volatile: readonly string[] = [],
): Promise<Replay | undefined> {
  const { data, error } = await db.rpc('begin_request', {
    p_function: fn,
    p_user: userId,
    p_key: key,
    // The *request*, not the response: the same key with a different body is a
    // client bug, and answering it with the first body would be confidently
    // wrong. Keys are sorted so that two encodings of one object agree.
    p_fingerprint: await sha256Hex(stableJson(withoutVolatile(body, volatile))),
  });
  if (error !== null) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as
    { state: string; response_status: number | null; response_body: unknown } | undefined;

  switch (row?.state) {
    case 'fresh':
      return undefined;
    case 'done':
      return { status: row.response_status ?? 200, body: row.response_body };
    case 'mismatch':
      throw new Refusal(
        'idempotency_mismatch',
        'That request was already made with different details.',
      );
    default:
      throw new Refusal('in_progress', 'That is still going through. Give it a moment.');
  }
}

export async function record(
  db: Db,
  fn: string,
  userId: string,
  key: IdempotencyKey,
  status: number,
  body: unknown,
): Promise<void> {
  const { error } = await db.rpc('finish_request', {
    p_function: fn,
    p_user: userId,
    p_key: key,
    p_status: status,
    p_body: body,
  });
  if (error !== null) throw error;
}

/** Key order is not part of a request's meaning, so it is not part of its digest. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/**
 * Gives an unfinished claim back, so a refused or failed request can be asked
 * again. Without it the `in_flight` row written by `claim` outlives the failure
 * and answers every retry with `in_progress`.
 */
export async function release(
  db: Db,
  fn: string,
  userId: string,
  key: IdempotencyKey,
): Promise<void> {
  const { error } = await db.rpc('release_request', {
    p_function: fn,
    p_user: userId,
    p_key: key,
  });
  if (error !== null) throw error;
}

/** The body as the idempotency key sees it: without the fields that are not the request. */
export function withoutVolatile(body: unknown, volatile: readonly string[]): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const kept = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([key]) => !volatile.includes(key)),
  );
  return kept;
}
