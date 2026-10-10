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
 * What joining costs, for `join-plan` and `redeem-invite` alike (SUS-113).
 *
 * The rule: **a limit is spent by the person who makes the attempts, never by
 * everybody who holds the link.** The old buckets were per link, so one person
 * (or one honest group opening a link together) could use up the allowance for
 * everyone else, and a call by somebody already in the circle was charged like a
 * stranger's. Now:
 *
 * - A call by an **active member of the circle the link opens costs nothing**.
 *   It is not counted anywhere. (Whether they are one is looked up first; if
 *   that lookup fails the caller is treated as a stranger, so a failure can only
 *   tighten a limit.)
 * - Anybody else is counted three ways, each keyed on who is asking:
 *   per link *and* caller, per caller across all links, and per address.
 *   Admission is bounded by the circle's member cap (ADR 0012), not by a counter
 *   everyone shares, so twenty people can join one link inside an hour,
 *   including from one address.
 * - The caller counters are what makes guessing slow: they count every attempt
 *   by a stranger, accepted or refused, and are small. A person joins once, so
 *   an honest caller never gets near them; somebody walking the code space
 *   meets the per-caller one within a few dozen tries.
 * - The address counter is sized for a household, an office or a carrier's
 *   shared address, as the anonymous sign-in limit is (§14: 60 an hour per
 *   address), and is high enough that a full circle of twenty arriving
 *   together stays far below it. It is what stops one script from minting
 *   fresh identities to get fresh per-caller allowances.
 *
 * These are volume limits, not permission: every rule that matters is decided in
 * the database.
 */
export const JOIN_LIMITS = {
  /** One caller on one link: a retry after `duplicate_name`, a second tap. */
  perLinkAndCaller: 10,
  /** One caller across every link: the brake on trying codes. */
  perCaller: 30,
  /** One address: a household or a carrier, twice the 60 a person may sign in. */
  perAddress: 120,
} as const;

export interface JoinLimitKeys {
  /** Scopes: one counter name per function, so the two never share a row. */
  scopes: { link: string; caller: string; address: string };
  /** The link as the function knows it: a plan code, or a digest of an invite secret. */
  link: string;
  userId: string;
  request: Request;
}

export function joinLimits(keys: JoinLimitKeys): Limit[] {
  const window = '1 hour';
  return [
    {
      scope: keys.scopes.link,
      key: `${keys.link}:${keys.userId}`,
      max: JOIN_LIMITS.perLinkAndCaller,
      window,
    },
    { scope: keys.scopes.caller, key: keys.userId, max: JOIN_LIMITS.perCaller, window },
    {
      scope: keys.scopes.address,
      key: callerAddress(keys.request),
      max: JOIN_LIMITS.perAddress,
      window,
    },
  ];
}

/**
 * Is this person already an active member of the circle? The one read a join
 * limit makes before deciding whether to charge.
 *
 * With the service client, because the caller may not be a member and RLS would
 * answer "no" for the wrong reason; it reads one count and returns a boolean.
 * Anything but a clear yes is a no, which charges the caller.
 */
export async function isActiveMember(
  db: Db,
  circleId: string | null,
  userId: string,
): Promise<boolean> {
  if (circleId === null) return false;
  const { count, error } = await db
    .from('circle_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('circle_id', circleId)
    .eq('user_id', userId)
    .eq('status', 'active');
  return error === null && (count ?? 0) > 0;
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
