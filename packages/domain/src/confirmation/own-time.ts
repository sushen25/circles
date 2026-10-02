/**
 * What a valid own time is (ADR 0050).
 *
 * The organiser may lock in a stretch the engine never offered. The freedom is
 * wide and not unbounded: the stretch must be a real one (it starts in the
 * future, on half hours, for a length the product already allows) and near
 * enough that a mistyped month does not become a plan.
 *
 * One function, called by the state machine's `own_time` guard, the picker and
 * the review screen. `private.is_valid_own_time` is the same rule in SQL and
 * refuses in the database as well as on the screen; both name the same codes,
 * in the same order, so a client can tell somebody what was wrong.
 *
 * No wording: a code, like every refusal (§5.4).
 */

import { asksAbout } from '../planning/days.js';
import type { DateWindow } from '../planning/types.js';
import type { Instant } from '../shared/instant.js';
import { type LocalDate, addDays } from '../shared/local-date.js';
import { type Zone, isAlignedToLocalSlot, toLocal } from '../shared/zone.js';

/** "30 minutes to 5 hours is the recommendation" (ticket SUS-138): the lengths the product already allows. */
export const OWN_TIME_MIN_MINUTES = 30;
export const OWN_TIME_MAX_MINUTES = 5 * 60;
/** How far past the plan's last day an own time may be. */
export const OWN_TIME_LOOKAHEAD_DAYS = 30;

export type OwnTimeProblem =
  | 'own_time_off_the_half_hour'
  | 'own_time_ends_before_it_starts'
  | 'own_time_too_short'
  | 'own_time_too_long'
  | 'own_time_in_the_past'
  | 'own_time_too_far_ahead';

/** What the rule needs about the plan: its zone and its dates. */
export type OwnTimePlan = {
  readonly zone: Zone;
  readonly window: DateWindow;
};

/** The last day a stretch may start on: the plan's last day, and thirty more. */
export function lastOwnTimeDay(plan: OwnTimePlan): LocalDate {
  return addDays(plan.window.end, OWN_TIME_LOOKAHEAD_DAYS);
}

/**
 * The first thing wrong with a stretch, or `undefined` when it is a valid own
 * time.
 *
 * Shape before the clock, as the SQL has it: a stretch that is off the half
 * hour is wrong whenever it is, and a client that sends one should hear that
 * first rather than "in the past".
 */
export function ownTimeProblem(
  plan: OwnTimePlan,
  start: Instant,
  end: Instant,
  now: Instant,
): OwnTimeProblem | undefined {
  if (!isAlignedToLocalSlot(start, plan.zone) || !isAlignedToLocalSlot(end, plan.zone)) {
    return 'own_time_off_the_half_hour';
  }
  if (end <= start) return 'own_time_ends_before_it_starts';
  const minutes = (end - start) / 60_000;
  if (minutes < OWN_TIME_MIN_MINUTES) return 'own_time_too_short';
  if (minutes > OWN_TIME_MAX_MINUTES) return 'own_time_too_long';
  if (start <= now) return 'own_time_in_the_past';
  if (toLocal(start, plan.zone).date > lastOwnTimeDay(plan)) return 'own_time_too_far_ahead';
  return undefined;
}

/**
 * The two things the organiser is told plainly before locking an own time in
 * (manifesto §3.4: the override is never silent), and the two the confirmation
 * and the analytics record.
 *
 * Both are facts, not verdicts: whether the time is below the plan's number, and
 * whether the day is one the plan never asked about. A screen says them in words
 * (`copy`), and says nothing when neither holds.
 */
export type OwnTimeCautions = {
  /** Fewer people can make it than the plan asked for. */
  readonly belowQuorum: boolean;
  /** The plan's dates never included this day. */
  readonly outsidePlanDays: boolean;
};

export function ownTimeCautions(
  plan: OwnTimePlan & { readonly quorum: number },
  start: Instant,
  availableCount: number,
): OwnTimeCautions {
  return {
    belowQuorum: availableCount < plan.quorum,
    outsidePlanDays: !asksAbout(plan.window, toLocal(start, plan.zone).date),
  };
}
