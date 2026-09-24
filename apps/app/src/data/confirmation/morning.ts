import type { ShortCode } from '@circles/contracts';
import {
  fromISO,
  isRetrospective,
  morningAfter,
  zone,
  type AttendanceStatus,
  type Instant,
} from '@circles/domain';

import { authClient } from '../auth/client';
import { deviceTimeZone } from '../auth/profile';
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
 * **Asked the morning after** (§5.10): from nine the next morning where the
 * reader is (the domain's `morningAfter`), the same moment the "did it
 * happen?" email goes (review round 5). Two clocks, each for what it can
 * answer: "has it ended?" is the **database's** — `report-outcome` refuses
 * both answers before `ends_at`, so a phone running fast can never be offered a
 * question the server would turn down — and "is it morning yet?" is this
 * device's, because it is only about when to bring the question up. The
 * screens themselves take an answer from the end, as the server does.
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

export async function morningAfterOf(
  circleId: string,
  now: Instant = fromISO(new Date().toISOString()),
  where: string | undefined = deviceTimeZone(),
): Promise<MorningAfter | null> {
  const client = authClient();
  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;
  if (me === undefined) return null;

  const { data: plans, error } = await client
    .from('plans')
    .select('id, short_code, state, revision, organiser_user_id, time_zone')
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
    // Every one, not the newest few: a question is asked until it is answered
    // or put off, and a circle meets a dozen times a year (review round 4).
    .order('ends_at', { ascending: false });
  if (endedError !== null) throw new Error(FAILED);
  // A plan's current revision only: an older one was superseded by a reopen.
  // And only once it is the morning after, where the reader is — in the
  // plan's zone when this device cannot say.
  const current = ended.filter((c) => {
    const plan = planOf.get(c.plan_id);
    if (plan === undefined || plan.revision !== c.revision) return false;
    return morningAfter(fromISO(c.ends_at), zoneOr(where, plan.time_zone)) <= now;
  });
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

/** The reader's zone, or a fallback when the runtime cannot name one. */
function zoneOr(value: string | undefined, fallback: string) {
  try {
    return zone(value ?? fallback);
  } catch {
    return zone(fallback);
  }
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
