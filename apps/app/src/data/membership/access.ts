import { acceptsAnswers, fromISO, type Instant, type PlanState } from '@circles/domain';
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
    }
  | { membership: 'not_member' };

export async function planAccess(code: ShortCode): Promise<PlanAccess> {
  const { data, error } = await authClient()
    .from('plans')
    .select('circle_id, state')
    .eq('short_code', code)
    .maybeSingle();

  if (error !== null) throw new Error('plan access lookup failed');
  if (data === null) return { membership: 'not_member' };

  return {
    membership: 'member',
    circleId: data.circle_id as CircleId,
    state: data.state as PlanState,
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
 * **It does not make them a participant.** `replace_response` accepts answers
 * only from `plan_participants` of the current revision, and joining the
 * circle adds nobody to a plan already running — spec §9 makes that an opt-in,
 * and no opt-in exists yet. So somebody who joins after the plan was created
 * lands on its availability screen and cannot yet answer it. Recorded on S1-25,
 * which owns that screen and the opt-in it needs.
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
