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
  /**
   * How much this attempt costs, when one request carries many of the thing
   * being limited. A batch of fifty analytics events is fifty events; charging
   * it as one turns "six hundred a minute" into thirty thousand.
   */
  cost?: number;
}

export async function within(db: Db, limit: Limit): Promise<boolean> {
  const { data, error } = await db.rpc('take_rate_token', {
    p_scope: limit.scope,
    p_key_hash: await sha256Hex(limit.key),
    p_limit: limit.max,
    p_window: limit.window,
    p_cost: limit.cost ?? 1,
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
 *
 * `cf-connecting-ip` and nothing else. Read on `circles-dev` on 3 October 2026
 * (the readings are in docs/runbooks/environments.md): Supabase's Cloudflare
 * layer writes it with the real client address, and a request that arrives
 * carrying one of its own is refused there (HTTP 403, Cloudflare error 1000)
 * before it reaches a function, so a client cannot choose this value.
 *
 * The other headers are not read, on purpose. `x-real-ip` never arrived.
 * `x-forwarded-for` arrived rewritten by the platform, so a forged entry did
 * not survive, but its shape is a list of hops the platform may change, and a
 * second source is a second thing to be wrong about. `forwarded` passed
 * through exactly as the caller wrote it, which is the kind of header a limit
 * must never trust.
 *
 * Without `cf-connecting-ip` (the local stack has no Cloudflare in front, and
 * a request should never lack it on a hosted project) every caller shares the
 * one bucket `unknown`. That fails closed: the limit gets tighter, never
 * looser, and a missing header cannot be used to dodge it.
 */
export function callerAddress(request: Request): string {
  const address = request.headers.get('cf-connecting-ip')?.trim();
  return address !== undefined && address !== '' ? address : 'unknown';
}
