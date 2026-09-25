/**
 * The last part of the idempotency key: which *instance* of a kind this is.
 *
 * Channel, recipient, plan, revision and kind are already in the key, so
 * `occurrence` only has to separate two sends that agree on all of those and
 * are still legitimately different. Most kinds have exactly one instance per
 * plan revision and say so; the ones that recur name what they recur over.
 *
 * Getting this wrong is quiet in both directions. Too coarse and a real
 * message is swallowed as a duplicate; too fine and the unique index stops
 * being a defence against retries.
 */

import type { CircleId } from '../circles/types.js';
import type { ConfirmationId } from '../confirmation/types.js';
import { isTonightWindow } from '../planning/presets.js';
import type { DateWindow } from '../planning/types.js';
import { type Instant, addMinutes, isBefore, toISO } from '../shared/instant.js';
import type { LocalDate } from '../shared/local-date.js';
import type { Zone } from '../shared/zone.js';
import type { NotificationKind } from './kinds.js';

/**
 * "There is one of these per plan revision." The key already carries the plan
 * and the revision, so the occurrence adds nothing — which is the correct
 * answer, not a placeholder.
 */
export const ONCE = 'once';

export type OccurrenceInput = {
  /** For the kinds that belong to a confirmation rather than to a revision. */
  readonly confirmationId?: ConfirmationId | undefined;
  /** For `about_time`: which circle is due, and the local date it became due. */
  readonly circleId?: CircleId | undefined;
  readonly dueDate?: LocalDate | undefined;
  /**
   * For `changed`: which material change this is. The domain event's id does
   * the job — one event, one message.
   */
  readonly changeId?: string | undefined;
  /**
   * For `verify_email`: the verification request. A resend invalidates the
   * previous token (spec §5.8) and is a new email, not a duplicate of the old.
   */
  readonly verificationId?: string | undefined;
  /**
   * For `replies_closed`: the deadline that closed. "Give it one more day" is
   * an `adjust`, which leaves the revision where it is, so the key alone cannot
   * tell the first closure from the second (spec §5.7, ADR 0039).
   */
  readonly deadline?: Instant | undefined;
  /**
   * For `replies_closed`: the reminder a day after that deadline, when nothing
   * has been decided since (`FOLLOW_UP`). Absent is the letter at the deadline.
   */
  readonly followUp?: boolean | undefined;
  /**
   * For `replies_closed` and `options_ready` sent to somebody a plan has just
   * been handed to: the hand-off event. Their `once` may already be spent —
   * a plan handed back to its first organiser — and a hand-off is a new
   * reason to write (S2-05 review round 1).
   */
  readonly handOffId?: string | undefined;
};

/**
 * The suffix of the one `replies_closed` that is not the deadline's own: the
 * nudge a day later, if the plan is still waiting on its organiser (S2-05).
 */
export const FOLLOW_UP = '+24h';

/** Length-prefixed, so a circle id containing a separator cannot shift a boundary. */
function part(value: string): string {
  return `${value.length}:${value}`;
}

function required(value: string | undefined, kind: NotificationKind, what: string): string {
  if (value === undefined || value.length === 0) {
    throw new RangeError(`occurrence: ${kind} needs ${what}`);
  }
  return value;
}

export function occurrenceFor(kind: NotificationKind, input: OccurrenceInput = {}): string {
  switch (kind) {
    // One per plan revision. A second `new_plan` for the same revision is a
    // retry, and the index should swallow it. (A quiet ask expires once, and its
    // plan never asks again.)
    case 'new_plan':
    case 'quiet_ask':
    case 'threshold_initiator':
    case 'threshold_keen':
    case 'quiet_expired':
    case 'cancelled':
      return ONCE;

    // Once per revision, and once more for each hand-off: "the options are
    // ready" is news to whoever the plan was just handed to.
    case 'options_ready':
      return input.handOffId === undefined ? ONCE : `handed:${part(input.handOffId)}`;

    // Once per **deadline**, not per revision, and once more a day after it.
    // "Give it one more day" moves the deadline without bumping the revision,
    // so `ONCE` gave the second closure the first one's key and the unique
    // index swallowed it: an organiser whose extended deadline closed heard
    // nothing, and email is their only channel on the web (SUS-36 round 5).
    // The instant is length-prefixed like `about_time`'s parts, and rendered
    // by `toISO` so the drain and a test agree on it to the millisecond.
    case 'replies_closed': {
      if (input.deadline === undefined) {
        throw new RangeError(`occurrence: ${kind} needs the deadline`);
      }
      const closed = part(toISO(input.deadline));
      if (input.handOffId !== undefined) return `${closed}handed:${part(input.handOffId)}`;
      return input.followUp === true ? closed + FOLLOW_UP : closed;
    }

    // *Not* once per revision. A reschedule bumps the revision, but a place
    // correction on a live confirmation does not — and §5.8 promises
    // subscribers every material change of time or place. Two changes in one
    // revision sharing an occurrence means the second one is dropped by the
    // unique index and nobody is told the venue moved.
    case 'changed':
      return required(input.changeId, kind, 'the change id');

    // Also one per revision — and the cross-revision half of "at most one per
    // member per plan" is an audience rule, not a key: an edit bumps the
    // revision, so the key alone would let an edit re-remind everybody.
    // `EligibilityContext.alreadySent` is what stops that.
    case 'deadline_approaching':
      return ONCE;

    // Tied to the confirmation, because these three describe a specific
    // evening. A reopen supersedes the confirmation and makes a new one, so a
    // fresh id is exactly the signal that this is a different message.
    case 'locked_in':
    case 'reminder':
    case 'did_it_happen':
    case 'did_it_happen_participant':
      return required(input.confirmationId, kind, 'a confirmation id');

    // Recurs for the life of the circle, with no plan to hang from — so the
    // circle has to be in the occurrence, or one person who belongs to two
    // circles that fall due on the same day gets one nudge instead of two and
    // the second is discarded as a retry. The date is what makes September's
    // nudge different from October's.
    case 'about_time':
      return (
        part(required(input.circleId, kind, 'the circle id')) +
        part(required(input.dueDate, kind, 'the due date'))
      );

    case 'verify_email':
      return required(input.verificationId, kind, 'a verification id');
  }
}

/**
 * How long before the deadline `deadline_approaching` goes (spec §5.8: "24
 * hours before").
 *
 * **Tonight is the exception** (S2-06): a tonight plan's replies close within
 * the hour it was made (§5.3), so "a day before" is before the plan existed and
 * the reminder would go out the minute the dispatcher first saw it — to people
 * who have only just been asked. Twenty minutes before is still early enough
 * to answer. A plan is tonight's when its window is one day and the deadline
 * falls on that day (`isTonightWindow`); the plan does not store its preset.
 */
export const DEADLINE_REMINDER_LEAD_MINUTES = 24 * 60;
export const TONIGHT_REMINDER_LEAD_MINUTES = 20;

export type RemindablePlan = {
  readonly window: DateWindow;
  readonly zone: Zone;
  readonly responseDeadline: Instant;
};

/** When the deadline reminder for this plan is due. */
export function deadlineReminderAt(plan: RemindablePlan): Instant {
  const lead = isTonightWindow(plan.window, plan.zone, plan.responseDeadline)
    ? TONIGHT_REMINDER_LEAD_MINUTES
    : DEADLINE_REMINDER_LEAD_MINUTES;
  return addMinutes(plan.responseDeadline, -lead);
}

/** Whether `now` is inside the reminder's window: past its lead, before the deadline. */
export function deadlineReminderDue(plan: RemindablePlan, now: Instant): boolean {
  return !isBefore(now, deadlineReminderAt(plan)) && isBefore(now, plan.responseDeadline);
}
