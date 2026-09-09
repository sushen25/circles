/**
 * When replies close (spec §5.3).
 *
 * The deadline is a promise to the people being asked, not a lock on the
 * organiser: they may confirm before or after it (spec §5.7). Its real job is
 * to say when a reminder goes out and when the plan stops waiting.
 *
 * One invariant runs through all of it: **a deadline is never after the last
 * possible start**, because replies that arrive once the plan can no longer
 * happen are replies to nothing.
 */

import { type Instant, addMinutes, earliest, isAfter, latest } from '../shared/instant.js';
import { fromLocal } from '../shared/zone.js';
import type { Plan, WindowPreset } from './types.js';

const HOUR = 60;

/**
 * The margin the **tonight** default leaves before the last possible start
 * (spec §5.3). It is a property of that one default, not a rule about plans:
 * the spec lets the organiser move the deadline anywhere up to the last
 * possible start, and nothing here may narrow that.
 */
export const TONIGHT_MARGIN_MINUTES = 30;

/**
 * The latest moment the meetup could still begin: the last day of the window,
 * at the end of the daily band minus the duration. A 2-hour plan in a band
 * ending 22:30 cannot start after 20:30.
 *
 * Computed in the plan's zone, so a window whose last day crosses a DST change
 * still ends at the local hour people were shown.
 */
export function lastPossibleStart(plan: Plan): Instant {
  const latestStartMin = plan.daily.endMin - plan.durationMinutes;
  if (latestStartMin < plan.daily.startMin) {
    // The band is shorter than the meetup. Not a valid plan; the earliest
    // moment is the honest answer and the caller should have refused sooner.
    return fromLocal(plan.window.end, plan.daily.startMin, plan.zone);
  }
  return fromLocal(plan.window.end, latestStartMin, plan.zone);
}

/** Never after the last possible start. That is the whole rule. */
export function clampDeadline(deadline: Instant, latestStart: Instant): Instant {
  return earliest(deadline, latestStart);
}

/**
 * The default the organiser is offered, or `undefined` when there is no valid
 * deadline to offer.
 *
 * Tonight is the tight one: the earlier of an hour from now and
 * `TONIGHT_MARGIN_MINUTES` before the last possible start. An hour is long
 * enough for a group chat to notice and short enough that "tonight" still means
 * tonight.
 *
 * Two invariants bound the answer, and they can conflict:
 *
 * - **Never after the last possible start** (spec §5.3) — replies that arrive
 *   once the plan cannot happen are replies to nothing.
 * - **Never before `createdAt`** — a deadline in the past closes replies the
 *   instant it is saved.
 *
 * When `latestStart` is already behind `createdAt` no instant satisfies both,
 * and the honest answer is that this plan has no deadline rather than a value
 * that breaks one of them. An earlier revision of this function floored at
 * `createdAt` unconditionally, which produced a deadline *after* the last
 * possible start — trading one broken invariant for the other.
 */
export function defaultDeadline(
  preset: WindowPreset,
  createdAt: Instant,
  latestStart: Instant,
): Instant | undefined {
  if (isAfter(createdAt, latestStart)) return undefined;
  return latest(createdAt, uncappedDefault(preset, createdAt, latestStart));
}

function uncappedDefault(preset: WindowPreset, createdAt: Instant, latestStart: Instant): Instant {
  switch (preset) {
    case 'tonight':
      return earliest(
        addMinutes(createdAt, HOUR),
        addMinutes(latestStart, -TONIGHT_MARGIN_MINUTES),
      );
    case 'this_weekend':
    case 'next_7_days':
      return clampDeadline(addMinutes(createdAt, 24 * HOUR), latestStart);
    case 'next_14_days':
      return clampDeadline(addMinutes(createdAt, 72 * HOUR), latestStart);
    case 'custom':
      // A custom window is whatever the person chose, so it gets the middle
      // default rather than a guess based on its length.
      return clampDeadline(addMinutes(createdAt, 24 * HOUR), latestStart);
  }
}

/**
 * Whether an organiser-chosen deadline is allowed.
 *
 * The spec's rule is the upper bound alone — "editable, never after the last
 * possible start" (§5.3) — so a deadline half an hour away is permitted, and
 * this must not invent a minimum. Pass `now` to also reject one in the past,
 * which is the other end of the same sentence rather than a new rule.
 */
export function isDeadlineAllowed(deadline: Instant, latestStart: Instant, now?: Instant): boolean {
  if (isAfter(deadline, latestStart)) return false;
  return now === undefined || !isAfter(now, deadline);
}

/**
 * "Give it one more day" (spec §5.7). An extension never runs past the last
 * possible start, which is what stops a plan being extended into nonexistence.
 */
export function extendDeadline(current: Instant, latestStart: Instant, hours = 24): Instant {
  return earliest(addMinutes(current, hours * HOUR), latestStart);
}
