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

import {
  type Instant,
  MINUTE_MILLIS,
  addMinutes,
  earliest,
  instant,
  isAfter,
} from '../shared/instant.js';
import { addDays } from '../shared/local-date.js';
import { type Zone, fromLocal, offsetMinutes, toLocal } from '../shared/zone.js';
import type { PlanTiming, WindowPreset } from './types.js';

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
export function lastPossibleStart(plan: PlanTiming): Instant {
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
 * The day-based defaults (a day, three days) are rounded up to the next whole
 * hour in `zone`, so no deadline is shown on an odd minute. Tonight is not:
 * its hour is already a promise about the evening, and rounding it would
 * stretch an hour into nearly two.
 *
 * Two invariants bound the answer, and they can conflict:
 *
 * - **Never after the last possible start** (spec §5.3) — replies that arrive
 *   once the plan cannot happen are replies to nothing.
 * - **Never before `createdAt`** — a deadline in the past closes replies the
 *   instant it is saved.
 *
 * When `latestStart` is not after `createdAt` no instant satisfies both, and
 * the honest answer is that this plan has no deadline rather than a value that
 * breaks one of them. An earlier revision of this function floored at
 * `createdAt` unconditionally, which produced a deadline *after* the last
 * possible start — trading one broken invariant for the other.
 *
 * When the preferred default alone lands in the past — tonight's margin, on a
 * plan whose last possible start is twenty minutes away — the answer is the
 * last possible start itself, not `createdAt`. `createdAt` is a deadline that
 * closes replies the moment the plan is saved; the last possible start is the
 * latest value the spec allows and hands the circle every minute there is.
 * Refusing instead would be a minimum response time, which §5.3 does not have.
 */
export function defaultDeadline(
  preset: WindowPreset,
  createdAt: Instant,
  latestStart: Instant,
  zone: Zone,
): Instant | undefined {
  if (!isAfter(latestStart, createdAt)) return undefined;
  const preferred = uncappedDefault(preset, createdAt, latestStart, zone);
  return isAfter(preferred, createdAt) ? preferred : latestStart;
}

/**
 * Up to the next whole hour on the plan's own clock, so a default reads
 * "Mon 12 Oct, 7:00 pm" and never "6:22 pm". Rounded up, never down: the
 * organiser is never given less time than the preset promises. A moment already
 * on the hour stays put. The cap at the last possible start is applied after.
 */
export function ceilToLocalHour(value: Instant, z: Zone): Instant {
  const hourMillis = HOUR * MINUTE_MILLIS;
  const up = (at: Instant): Instant => {
    const offset = offsetMinutes(at, z) * MINUTE_MILLIS;
    return instant(Math.ceil((at + offset) / hourMillis) * hourMillis - offset);
  };
  // The offset can differ at the boundary: a half-hour daylight-saving change
  // (Lord Howe) lands the first guess on :30. Round again from there, which
  // uses the offset that applies at the new moment; it only ever moves later.
  let rounded = up(value);
  for (let pass = 0; pass < 3 && toLocal(rounded, z).minutesOfDay % HOUR !== 0; pass += 1) {
    rounded = up(rounded);
  }
  return rounded;
}

/**
 * The hour the day-based defaults land on: 6 pm on the plan's own clock, when a
 * group chat is awake and a deadline reads as a time somebody picked (ADR 0090,
 * which amends ADR 0076's rounding up to the hour).
 */
export const REPLY_HOUR = 18;

/**
 * 6 pm, `days` calendar days after the day the plan is made, on the plan's own
 * clock: a plan made on Thursday morning with a three-day default closes on
 * Sunday at 6 pm, "about three days out" and never on an odd hour. The calendar
 * day, not 24-hour multiples, so a daylight-saving change still lands on the
 * hour people were shown.
 */
export function replyTime(createdAt: Instant, days: number, zone: Zone): Instant {
  const today = toLocal(createdAt, zone).date;
  return fromLocal(addDays(today, days), REPLY_HOUR * HOUR, zone);
}

function uncappedDefault(
  preset: WindowPreset,
  createdAt: Instant,
  latestStart: Instant,
  zone: Zone,
): Instant {
  switch (preset) {
    case 'tonight':
      return earliest(
        addMinutes(createdAt, HOUR),
        addMinutes(latestStart, -TONIGHT_MARGIN_MINUTES),
      );
    case 'this_weekend':
    case 'next_7_days':
      return clampDeadline(replyTime(createdAt, 1, zone), latestStart);
    case 'next_14_days':
    case 'next_28_days':
      return clampDeadline(replyTime(createdAt, 3, zone), latestStart);
    case 'custom':
      // A custom window is whatever the person chose, so it gets the middle
      // default rather than a guess based on its length.
      return clampDeadline(replyTime(createdAt, 1, zone), latestStart);
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
