import { Refusal } from './problem.ts';
import type { Db } from './db.ts';
import { sha256Hex } from './hash.ts';

/**
 * The abuse limits (§14: "redemption rate-limited per IP and per circle").
 *
 * These are not authorisation and must never be the only thing standing between
 * a caller and something they should not have — every rule that matters is
 * enforced in the database, where skipping this function cannot reach it. What
 * a limit buys is volume: a script that has a live invite link still cannot use
 * it a thousand times an hour.
 *
 * Every key is hashed before it leaves here. The per-IP limit would otherwise
 * write an address into a table, and an address is a person.
 */

export interface Limit {
  /** A short name for the counter, e.g. `redeem_ip`. Appears in no log. */
  scope: string;
  /** What is being counted against — an address, a circle id. Hashed here. */
  key: string;
  max: number;
  window: string;
}

export async function within(db: Db, limit: Limit): Promise<boolean> {
  const { data, error } = await db.rpc('take_rate_token', {
    p_scope: limit.scope,
    p_key_hash: await sha256Hex(limit.key),
    p_limit: limit.max,
    p_window: limit.window,
  });
  if (error !== null) throw error;
  return data === true;
}

/**
 * Every limit, or a refusal. Checked in order and *all* of them counted: a
 * caller who trips the per-circle limit should also have their per-IP attempt
 * recorded, or the cheaper limit becomes a way to hide from the other.
 */
export async function enforce(db: Db, limits: readonly Limit[]): Promise<void> {
  const results = await Promise.all(limits.map((limit) => within(db, limit)));
  if (results.includes(false)) {
    throw new Refusal(
      'too_many_requests',
      'That has been tried too many times. Try again in a little while.',
    );
  }
}

/**
 * The caller's address, as the edge saw it. Only ever used as a hash input.
 * `x-forwarded-for` is a list; the first entry is the client.
 */
export function callerAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first !== undefined && first !== '' ? first : 'unknown';
}
