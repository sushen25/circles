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

import type { ConfirmationId } from '../confirmation/types.js';
import type { LocalDate } from '../shared/local-date.js';
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
  /** For `about_time`: the local date the circle became due. */
  readonly dueDate?: LocalDate | undefined;
  /**
   * For `verify_email`: the verification request. A resend invalidates the
   * previous token (spec §5.8) and is a new email, not a duplicate of the old.
   */
  readonly verificationId?: string | undefined;
};

function required(value: string | undefined, kind: NotificationKind, what: string): string {
  if (value === undefined || value.length === 0) {
    throw new RangeError(`occurrence: ${kind} needs ${what}`);
  }
  return value;
}

export function occurrenceFor(kind: NotificationKind, input: OccurrenceInput = {}): string {
  switch (kind) {
    // One per plan revision. A second `new_plan` for the same revision is a
    // retry, and the index should swallow it.
    case 'new_plan':
    case 'quiet_ask':
    case 'threshold_initiator':
    case 'threshold_keen':
    case 'options_ready':
    case 'changed':
    case 'cancelled':
      return ONCE;

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
      return required(input.confirmationId, kind, 'a confirmation id');

    // Recurs for the life of the circle, with no plan to hang from. The due
    // date is what makes September's nudge a different message from October's.
    case 'about_time':
      return required(input.dueDate, kind, 'the due date');

    case 'verify_email':
      return required(input.verificationId, kind, 'a verification id');
  }
}
