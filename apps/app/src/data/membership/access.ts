import {
  acceptsAnswers,
  ANSWERABLE_STATES,
  fromISO,
  type Instant,
  type PlanState,
} from '@circles/domain';
import type { CircleId, ShortCode } from '@circles/contracts';

import { authClient } from '../auth/client';

/**
 * Whether the session in hand belongs to the circle a route is about.
 *
 * Answered by RLS rather than by asking: `plans` and `circles` are readable by
 * an active member of the circle and by nobody else, so a row coming back *is*
 * membership and no row is its absence. A separate "am I a member?" call would
 * be a second statement of the rule the policies already are.
 *
 * No row also covers a code that does not exist. That is deliberate — a
 * non-member is not entitled to learn which codes are real — and the guard
 * sends both to the same place: Continue-as, whose list is then empty.
 */

export type PlanAccess =
  | {
      membership: 'member';
      circleId: CircleId;
      state: PlanState;
      /**
       * A member the plan is not asking, while it is still asking (ADR 0022).
       * Somebody who joined the circle — by invite, or any way at all — after
       * this plan was made was never addressed by it, and `replace_response`
       * refuses them `not_a_participant`. "Opening that plan's link asks them":
       * the caller does that with `joinPlan` and no name.
       */
      needsAsking: boolean;
    }
  | { membership: 'not_member' };

export async function planAccess(code: ShortCode): Promise<PlanAccess> {
  const client = authClient();
  const { data, error } = await client
    .from('plans')
    .select('id, circle_id, state, revision')
    .eq('short_code', code)
    .maybeSingle();

  if (error !== null) throw new Error('plan access lookup failed');
  if (data === null) return { membership: 'not_member' };

  const state = data.state as PlanState;
  // The state only, not the deadline. The deadline is the server's to judge:
  // a phone whose clock runs ahead would decide the plan had closed, never ask,
  // and leave somebody unable to answer a plan that is still open. After the
  // deadline `join-plan` says `invite_inactive`, which costs one request.
  const asking = ANSWERABLE_STATES.includes(state);

  // Only asked about when it could matter: a plan that is not asking has
  // nothing to add anybody to, and the read is one more round trip.
  let asked = true;
  if (asking) {
    const { data: me } = await client.auth.getSession();
    const userId = me.session?.user.id;
    if (userId !== undefined) {
      const { data: row, error: rowError } = await client
        .from('plan_participants')
        .select('user_id')
        .eq('plan_id', data.id)
        .eq('revision', data.revision)
        .eq('user_id', userId)
        .maybeSingle();
      if (rowError !== null) throw new Error('plan access lookup failed');
      asked = row !== null;
    }
  }

  return {
    membership: 'member',
    circleId: data.circle_id as CircleId,
    state,
    needsAsking: asking && !asked,
  };
}

export type CircleAccess =
  { membership: 'member'; shortCode: ShortCode } | { membership: 'not_member' };

export async function circleAccess(id: string): Promise<CircleAccess> {
  const { data, error } = await authClient()
    .from('circles')
    .select('short_code')
    .eq('id', id)
    .maybeSingle();

  // An id that is not a UUID is a Postgres cast error, not "no such circle" —
  // but to a person it is the same thing: this is not a circle they are in.
  if (error !== null) {
    if (error.code === '22P02') return { membership: 'not_member' };
    throw new Error('circle access lookup failed');
  }
  if (data === null) return { membership: 'not_member' };

  return { membership: 'member', shortCode: data.short_code as ShortCode };
}

/** Where somebody who has just joined or rejoined a circle should land. */
export type Arrival = { kind: 'plan'; code: ShortCode } | { kind: 'circle'; id: CircleId };

/**
 * The plan that is asking for their times, if there is one; the circle if not
 * (S1-24). "Asking" is the domain's `acceptsAnswers`: an answerable state and
 * a deadline still ahead, the two things `replace_response` checks. The newest wins when there are several:
 * it is the one the link they were sent is most likely about.
 *
 * **It does not make them a participant; landing there does.** Joining the
 * circle by invite adds nobody to a plan already running (spec §9). The plan
 * route's gate sees a member the plan is not asking (`planAccess`'s
 * `needsAsking`) and asks it to, through `join-plan` with no name — ADR 0022's
 * "opening that plan's link asks them".
 */
export async function arrivalFor(
  circleId: CircleId,
  now: Instant = fromISO(new Date().toISOString()),
): Promise<Arrival> {
  const { data, error } = await authClient()
    .from('plans')
    .select('short_code, state, response_deadline')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (error !== null) throw new Error('arrival lookup failed');

  const open = (data ?? []).find((plan) =>
    acceptsAnswers(
      { state: plan.state as PlanState, responseDeadline: fromISO(plan.response_deadline) },
      now,
    ),
  );
  return open === undefined
    ? { kind: 'circle', id: circleId }
    : { kind: 'plan', code: open.short_code as ShortCode };
}
