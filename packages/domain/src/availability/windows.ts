/**
 * Turning what somebody painted into what the engine can trust.
 *
 * The engine assumes willing windows are 30-minute aligned, non-overlapping,
 * sorted and inside the plan (architecture §12). Rather than have every caller
 * promise that, this module is the one place that makes it true.
 *
 * Rounding is **inward**: a window is a claim about when someone is genuinely
 * free, so the safe error is to claim less. Rounding outward would invent
 * availability nobody offered, and the cost of that is a meetup someone cannot
 * actually attend.
 */

import { type Instant } from '../shared/instant.js';
import {
  type Interval,
  ceilToSlot,
  floorToSlot,
  intersect,
  interval,
  merge,
} from '../shared/interval.js';
import { addDays } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { type Result, err, ok } from '../shared/result.js';
import type { Plan } from '../planning/types.js';

export type WindowError =
  | { readonly code: 'outside_plan_window'; readonly window: Interval }
  | { readonly code: 'not_a_window'; readonly window: Interval };

/**
 * Every day of the plan's window, as the absolute span that day's daily band
 * covers in the plan's zone.
 *
 * Built day by day through `fromLocal` rather than by adding 24 hours, so the
 * day the clocks change is 23 or 25 hours long and the band still starts and
 * ends at the local times people were shown.
 */
export function planDays(plan: Plan): Interval[] {
  const days: Interval[] = [];
  let date = plan.window.start;
  while (date <= plan.window.end) {
    days.push(
      interval(
        fromLocal(date, plan.daily.startMin, plan.zone),
        fromLocal(date, plan.daily.endMin, plan.zone),
      ),
    );
    date = addDays(date, 1);
  }
  return days;
}

/** The whole plan, end to end, for a cheap "is this anywhere near it?" test. */
export function planBounds(plan: Plan): Interval {
  const days = planDays(plan);
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError('A plan window contains no days');
  }
  return interval(first.start, last.end);
}

/**
 * Align, clip to the daily bands, merge and sort.
 *
 * A window that falls entirely outside the plan is an error rather than
 * silently dropped: it means the caller and the plan disagree about what was
 * being asked, and swallowing that produces a response that looks deliberate.
 * A window that merely *overhangs* a day is clipped, because that is what a
 * finger on a touch screen does.
 */
export function normaliseWindows(
  windows: readonly Interval[],
  plan: Plan,
): Result<WindowError, Interval[]> {
  const days = planDays(plan);
  const kept: Interval[] = [];

  for (const raw of windows) {
    if (raw.end <= raw.start) {
      return err({ code: 'not_a_window', window: raw });
    }

    // Inward: start rounds up, end rounds down.
    const aligned = { start: ceilToSlot(raw.start), end: floorToSlot(raw.end) };
    if (aligned.end <= aligned.start) {
      // Smaller than a slot once aligned — a stray tap. Dropping it is right;
      // it is not an error, because the person did not mean anything by it.
      continue;
    }

    const pieces = days
      .map((day) => intersect(day, aligned as Interval))
      .filter((piece): piece is Interval => piece !== null);

    if (pieces.length === 0) {
      return err({ code: 'outside_plan_window', window: raw });
    }
    kept.push(...pieces);
  }

  return ok(merge(kept));
}

/** How much time a member has offered, across all their windows. */
export function totalMinutes(windows: readonly Interval[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start) / 60_000, 0);
}

/** Whether any single window is long enough to hold the meetup. */
export function canHostDuration(windows: readonly Interval[], durationMinutes: number): boolean {
  return windows.some((w) => (w.end - w.start) / 60_000 >= durationMinutes);
}

export function isWithinPlan(window: Interval, plan: Plan): boolean {
  return planDays(plan).some((day) => intersect(day, window) !== null);
}

/** The day a moment belongs to, as one of the plan's day spans. */
export function dayOf(plan: Plan, at: Instant): Interval | undefined {
  return planDays(plan).find((day) => at >= day.start && at < day.end);
}
