import type { ShortCode } from '@circles/contracts';

import { authClient } from '../auth/client';
import { sessionStorage } from '../auth/storage';

/**
 * Whether the circle has a morning-after question for the person reading it
 * (spec §5.10), and which: the organiser's "did it happen?" or a member's
 * "were you there?".
 *
 * **Only the circle's newest meetup.** The newest plan that was locked in, at
 * its current revision; if its evening is still ahead there is nothing to ask,
 * and an older one is not dug up — a circle that has met again since has moved
 * on, and nobody should be asked about a Thursday two plans ago.
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
 *   And not after "Not now" on this device.
 *
 * Reads only rows RLS shows a member: the plan, its confirmation, and the
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

export async function morningAfterOf(circleId: string): Promise<MorningAfter | null> {
  const client = authClient();
  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;
  if (me === undefined) return null;

  const { data: plans, error } = await client
    .from('plans')
    .select('id, short_code, state, revision, organiser_user_id')
    .eq('circle_id', circleId)
    .in('state', ['confirmed', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (error !== null) {
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  const plan = plans[0];
  if (plan === undefined) return null;

  // `'now'` is Postgres's own input for the current time (see `read.ts`).
  const { data: rows, error: confirmationError } = await client
    .from('meetup_confirmations')
    .select('id, status, starts_at, ends_at')
    .eq('plan_id', plan.id)
    .eq('revision', plan.revision)
    .in('status', ['active', 'completed'])
    .lte('ends_at', 'now')
    .order('confirmed_at', { ascending: false })
    .limit(1);
  if (confirmationError !== null) throw new Error(FAILED);
  const confirmation = rows[0];
  if (confirmation === undefined) return null;

  const found = {
    planId: plan.id,
    code: plan.short_code as ShortCode,
    confirmationId: confirmation.id,
    startsAt: confirmation.starts_at,
    endsAt: confirmation.ends_at,
  };

  if (plan.organiser_user_id === me) {
    const unanswered = plan.state === 'confirmed' && confirmation.status === 'active';
    return unanswered ? { ...found, ask: 'outcome' } : null;
  }

  const { data: mine, error: mineError } = await client
    .from('attendance')
    .select('status')
    .eq('confirmation_id', confirmation.id)
    .eq('user_id', me)
    .maybeSingle();
  if (mineError !== null) throw new Error(FAILED);
  if (mine === null || mine.status === 'was_there' || mine.status === 'missed') return null;
  // "Not now" on this device: asked once, then left alone (see below).
  if (await attendanceDismissed(me, confirmation.id)) return null;
  return { ...found, ask: 'attendance' };
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
