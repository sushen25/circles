import type { ShortCode } from '@circles/contracts';
import { isRetrospective, type AttendanceStatus } from '@circles/domain';

import { authClient } from '../auth/client';
import { sessionStorage } from '../auth/storage';

/**
 * Whether the circle has a morning-after question for the person reading it
 * (spec §5.10), and which: the organiser's "did it happen?" or a member's
 * "were you there?".
 *
 * **The newest meetup that still owes this person a question.** Every
 * confirmation in the circle whose evening has ended, newest first, and the
 * first one the reader has something to say about. Not merely the newest plan:
 * a circle can lock in its next catch-up before anybody has said whether the
 * last one happened, and that must not hide the question — the organiser's
 * answer is what moves "Last caught up" (review round 1).
 *
 * **"Has it finished?" is the database's clock**, as the confirmed screen's is:
 * `report-outcome` refuses both answers before the meetup has *ended*
 * (`outcome_too_early`, `attendance_too_early`), so the question appears at the
 * end, not the start — a phone a few hours fast would otherwise offer a button
 * the server turns down.
 *
 * - The organiser is asked until they answer: the plan is still `confirmed` and
 *   its confirmation `active`. Answering completes both.
 * - A member is asked if the plan asked them (they have an attendance row) and
 *   they have not said `was_there` or `missed`, while the confirmation is still
 *   one attendance can be written to — `active`, or `completed` by an outcome
 *   other than "it was cancelled". Never the organiser, whose report already
 *   says whether it happened; their own "I was there" would corroborate nothing.
 *   And not after "Not now" on this device: each meetup is asked once.
 *
 * Reads only rows RLS shows a member: the plans, their confirmations, and the
 * reader's own attendance. Nobody else's answer is read, or could be.
 */

export type MorningAfter = {
  planId: string;
  code: ShortCode;
  confirmationId: string;
  startsAt: string;
  endsAt: string;
  ask: 'outcome' | 'attendance';
};

const FAILED = 'morning-after lookup failed';

/**
 * How many of the most recently ended meetups the read looks through. A bound
 * on the read, not a product rule anybody should meet: each is asked until
 * answered or put off, so an unanswered one ten meetups back is a circle that
 * has long since moved on.
 */
const LOOKBACK = 10;

export async function morningAfterOf(circleId: string): Promise<MorningAfter | null> {
  const client = authClient();
  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;
  if (me === undefined) return null;

  const { data: plans, error } = await client
    .from('plans')
    .select('id, short_code, state, revision, organiser_user_id')
    .eq('circle_id', circleId)
    .in('state', ['confirmed', 'completed']);
  if (error !== null) {
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  if (plans.length === 0) return null;
  const planOf = new Map(plans.map((plan) => [plan.id, plan]));

  // `'now'` is Postgres's own input for the current time (see `read.ts`).
  const { data: ended, error: endedError } = await client
    .from('meetup_confirmations')
    .select('id, plan_id, revision, status, starts_at, ends_at')
    .in('plan_id', [...planOf.keys()])
    .in('status', ['active', 'completed'])
    .lte('ends_at', 'now')
    .order('ends_at', { ascending: false })
    .limit(LOOKBACK);
  if (endedError !== null) throw new Error(FAILED);
  // A plan's current revision only: an older one was superseded by a reopen.
  const current = ended.filter((c) => planOf.get(c.plan_id)?.revision === c.revision);
  if (current.length === 0) return null;

  const { data: mine, error: mineError } = await client
    .from('attendance')
    .select('confirmation_id, status')
    .eq('user_id', me)
    .in(
      'confirmation_id',
      current.map((c) => c.id),
    );
  if (mineError !== null) throw new Error(FAILED);
  const myStatus = new Map(mine.map((row) => [row.confirmation_id, row.status]));

  for (const confirmation of current) {
    const plan = planOf.get(confirmation.plan_id);
    if (plan === undefined) continue;
    const found = {
      planId: plan.id,
      code: plan.short_code as ShortCode,
      confirmationId: confirmation.id,
      startsAt: confirmation.starts_at,
      endsAt: confirmation.ends_at,
    };

    if (plan.organiser_user_id === me) {
      if (plan.state === 'confirmed' && confirmation.status === 'active') {
        return { ...found, ask: 'outcome' };
      }
      continue;
    }

    const status = myStatus.get(confirmation.id) as AttendanceStatus | undefined;
    if (status === undefined || isRetrospective(status)) continue;
    if (await attendanceDismissed(me, confirmation.id)) continue;
    return { ...found, ask: 'attendance' };
  }
  return null;
}

/**
 * "Not now" on a member's attendance question, remembered on this device for
 * this person and this meetup, so circle home asks once (S1-29). Device-local
 * on purpose: it is a preference about a prompt, not an answer, and nothing
 * about it belongs on the server — an unanswered question is not a "no".
 *
 * Storage that refuses costs only the memory: the prompt shows again.
 */
const PREFIX = 'circles.morning-after.';

function keyFor(userId: string, confirmationId: string): string {
  return `${PREFIX}${userId}.${confirmationId}`;
}

export async function setAttendanceDismissed(
  userId: string,
  confirmationId: string,
): Promise<void> {
  try {
    await sessionStorage.setItem(keyFor(userId, confirmationId), 'not_now');
  } catch {
    // Nothing to do: it will be asked again.
  }
}

export async function attendanceDismissed(
  userId: string,
  confirmationId: string,
): Promise<boolean> {
  try {
    return (await sessionStorage.getItem(keyFor(userId, confirmationId))) !== null;
  } catch {
    return false;
  }
}
