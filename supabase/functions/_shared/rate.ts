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
 * `cf-connecting-ip`, then `x-real-ip`: both are written by the proxy in front
 * of us and neither can be set by a client that reaches it. `x-forwarded-for`
 * is the fallback and it is a compromise — it is a *list* a client can start,
 * so its first entry is a value the caller chose and a determined one can vary
 * it to get a fresh bucket.
 *
 * The first entry anyway, rather than the last. The last is the hop our own
 * proxy added, which sounds safer and is worse where it is wrong: if that hop
 * is a gateway rather than the client — which is exactly what it is locally,
 * and may be what a Cloudflare edge is — then every caller in the world shares
 * one bucket and the limit denies service to everybody at once. A key that one
 * attacker can sidestep beats a key that locks everyone out.
 *
 * Which header actually arrives is a deployment fact and is not yet settled;
 * SUS-71 carries the check.
 */
export function callerAddress(request: Request): string {
  for (const header of ['cf-connecting-ip', 'x-real-ip']) {
    const direct = request.headers.get(header)?.trim();
    if (direct !== undefined && direct !== '') return direct;
  }

  const hops = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop !== '');
  return hops[0] ?? 'unknown';
}
