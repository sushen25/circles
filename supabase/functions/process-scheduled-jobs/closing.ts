import {
  FOLLOW_UP,
  type Instant,
  type NotificationKind,
  fromISO,
  isAfter,
  notificationSpec,
  occurrenceFor,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import type { PlanContext } from './context.ts';
import type { JobRow } from './drain.ts';
import type { Intent, OutboxEvent } from './events.ts';
import type { DueJob } from './send.ts';

/**
 * Replies closed with no decision (S2-05): the letters, and when they are no
 * longer true.
 *
 * Kept apart from `events.ts` and `send.ts` so that what this ticket says
 * about one kind is in one place, and so that the files every ticket touches
 * carry a line each rather than a paragraph.
 *
 * **Which instance.** `replies_closed` is once per *deadline* now, and once
 * more a day later (`occurrenceFor`, ADR 0039). The deadline comes from the
 * event, which the sweep stamped with the instant it saw, not from the plan as
 * it is when the drain gets there: an extension between the two would
 * otherwise spend the new deadline's key on the old deadline's letter.
 *
 * **When it is no longer true.** A letter written at the deadline can wait
 * until morning for quiet hours, and a lot can happen overnight. By the time it
 * is sent the organiser may have locked something in, given it one more day,
 * or handed it to somebody else — and each of those makes the letter wrong.
 */

/** When the plan's replies close, as it is now. Every plan context has a plan. */
function deadlineNow(context: PlanContext): Instant | undefined {
  return context.eligibility.plan?.responseDeadline;
}

/** The deadline an event is about: its own stamp, or the plan's for an event from before it carried one. */
function deadlineOf(event: OutboxEvent, context: PlanContext): Instant | undefined {
  const stamped = event.payload['deadline'];
  return typeof stamped === 'string' ? fromISO(stamped) : deadlineNow(context);
}

/** `planning.deadline_passed`: the letter at the deadline, or the one a day after it. */
export function repliesClosedIntent(
  event: OutboxEvent,
  context: PlanContext,
  now: Instant,
): Intent {
  return {
    kind: 'replies_closed',
    occurrence: occurrenceFor('replies_closed', {
      deadline: deadlineOf(event, context),
      followUp: event.payload['follow_up'] === FOLLOW_UP,
    }),
    desiredAt: now,
  };
}

/** Still waiting on its organiser: asking, or with options, and not locked in. */
function undecided(context: PlanContext): boolean {
  return context.planState === 'collecting' || context.planState === 'ready';
}

/**
 * `planning.organiser_changed`: tell the new organiser it is theirs, with the
 * one letter that says what is waiting for them.
 *
 * Replies closed → `replies_closed`, which opens the screen with the three
 * ways out; options on offer and replies still open → `options_ready`; still
 * collecting → nothing yet, because `options_ready` will reach them when there
 * are options (its key names the recipient, so a first-time organiser has not
 * spent it).
 * Addressed through `recipientsFor`'s `organiser` audience, which reads the
 * plan as it is now: the person the plan was handed to.
 */
export function handedOverIntents(
  event: OutboxEvent,
  context: PlanContext,
  now: Instant,
): readonly Intent[] {
  const deadline = deadlineNow(context);
  if (!undecided(context) || deadline === undefined) return [];
  // Keyed on the hand-off itself, so a plan handed back to somebody who has
  // had this letter before — even one skipped when they let it go — is told
  // again: their earlier key is taken whatever its status (review round 1).
  const handOffId = event.id;
  if (!isAfter(deadline, now)) {
    return [
      {
        kind: 'replies_closed',
        occurrence: occurrenceFor('replies_closed', { deadline, handOffId }),
        desiredAt: now,
      },
    ];
  }
  if (context.planState === 'ready') {
    return [
      {
        kind: 'options_ready',
        occurrence: occurrenceFor('options_ready', { handOffId }),
        desiredAt: now,
      },
    ];
  }
  return [];
}

/**
 * Before a drain writes a `replies_closed`, the older ones still held for this
 * plan are skipped as `superseded` — all but the rows it is about to write, so
 * a re-drained event cannot skip its own letter (`dispatch_supersede_closing`).
 * A job carries no deadline, so this is the one moment the two can be told
 * apart (review round 1).
 */
export async function supersedeClosing(
  service: Db,
  planId: string | null,
  rows: readonly JobRow[],
): Promise<void> {
  const closing = rows.filter((row) => row.kind === 'replies_closed');
  if (planId === null || closing.length === 0) return;
  const { error } = await service.rpc('dispatch_supersede_closing', {
    p_plan_id: planId,
    p_keep: closing.map((row) => row.idempotency_key),
  });
  if (error !== null) throw error;
}

/**
 * Why a due job should not go, at the moment of sending, or `undefined`.
 *
 * - `organiser_changed`: an organiser letter to somebody who no longer
 *   organises the plan. `hand_off_organiser` skips these in its own
 *   transaction; this catches one the drain wrote in the same tick.
 * - `already_decided`: replies closed on a plan that has since been locked in.
 *   Terminal states are `plan_finished` already; `confirmed` is not terminal,
 *   and "replies have closed and no time is locked in" is false once one is.
 * - `replies_reopened`: the deadline is in the future again — one more day was
 *   given while the letter waited — so replies are not closed. The new
 *   deadline has a letter of its own, when it passes.
 */
export function closingHeld(
  job: DueJob,
  context: PlanContext | null,
  now: Instant,
): string | undefined {
  if (context === null) return undefined;
  if (
    notificationSpec(job.kind as NotificationKind).audience === 'organiser' &&
    context.organiserUserId !== job.user_id
  ) {
    return 'organiser_changed';
  }
  if (job.kind !== 'replies_closed') return undefined;
  if (!undecided(context)) return 'already_decided';
  const deadline = deadlineNow(context);
  if (deadline !== undefined && isAfter(deadline, now)) return 'replies_reopened';
  return undefined;
}
