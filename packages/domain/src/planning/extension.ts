/**
 * "Give it one more day" (spec §5.7), as the replies-closed screen offers it and
 * `public.extend_deadline` carries it out (S2-05).
 *
 * Three rules, and the database holds the same three:
 *
 * - **A day from now, or from the deadline if that is later.** The screen is
 *   opened after replies have closed, often hours after, and "one more day"
 *   counted from a deadline that went yesterday afternoon is an hour or two.
 * - **Never later than half an hour before the last possible start.** Replies
 *   that close as the meetup could begin leave nobody time to decide, and the
 *   spec's "never past the last possible start" is the outer bound of that, not
 *   the target. ADR 0010 lets a deadline sit *at* the last start, so there may
 *   be nothing left to extend into: then the answer is a refusal the screen can
 *   word, never a button that does nothing.
 * - **Once per revision.** "Nobody wants to decide" is the failure this screen
 *   exists for, and a button that can be pressed every day is that failure with
 *   a nicer face. An edit or a reopen is a new question with a new deadline,
 *   so it earns a new day.
 */

import { type Instant, addMinutes, isAfter, latest } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import { extendDeadline } from './deadline.js';

/** How long one more day is. */
export const EXTENSION_HOURS = 24;

/** How long before the last possible start an extension must stop. */
export const EXTENSION_MARGIN_MINUTES = 30;

export type ExtensionRefusal =
  /** This revision's one extension has been used. */
  | 'already_extended'
  /** The cut-off is not after the deadline, or not after now: nothing to give. */
  | 'no_time_to_extend';

export type ExtensionInput = {
  readonly current: Instant;
  /** `lastPossibleStart` of the plan as it is. */
  readonly latestStart: Instant;
  readonly now: Instant;
  /** Whether this revision's extension has already been spent. */
  readonly alreadyExtended: boolean;
};

/** The latest an extension may run to. */
export function extensionCutoff(latestStart: Instant): Instant {
  return addMinutes(latestStart, -EXTENSION_MARGIN_MINUTES);
}

/** The deadline one more day would give, or why there is none to give. */
export function oneMoreDay(input: ExtensionInput): Result<ExtensionRefusal, Instant> {
  if (input.alreadyExtended) return err('already_extended');
  const next = extendDeadline(
    latest(input.current, input.now),
    extensionCutoff(input.latestStart),
    EXTENSION_HOURS,
  );
  if (!isAfter(next, input.current) || !isAfter(next, input.now)) {
    return err('no_time_to_extend');
  }
  return ok(next);
}
