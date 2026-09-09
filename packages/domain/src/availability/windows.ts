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
import { type Interval, contains, intersect, interval, merge } from '../shared/interval.js';
import { addDays } from '../shared/local-date.js';
import { ceilToLocalSlot, floorToLocalSlot, fromLocal } from '../shared/zone.js';
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

    // Whether this belongs to the plan at all is asked of the **raw** window,
    // before rounding. A fifteen-minute window on a date the plan never
    // mentions is a caller/plan disagreement, and rounding it away first would
    // report an empty response as though the person had deliberately given one.
    const touchesPlan = days.some((day) => intersect(day, raw) !== null);
    if (!touchesPlan) {
      return err({ code: 'outside_plan_window', window: raw });
    }

    // Inward: start rounds up, end rounds down — and to the plan zone's local
    // half hours, not the epoch's. They coincide in most zones and do not in
    // Kathmandu (+05:45) or Chatham (+12:45), where a locally tidy 09:00 sits
    // at 03:15 UTC; rounding that to epoch boundaries turned 09:00–10:00 into
    // 09:15–09:45 and threw away half of what the person offered. The painter
    // builds its grid from local times, so local is the alignment that matches
    // what they saw.
    const aligned = {
      start: ceilToLocalSlot(raw.start, plan.zone),
      end: floorToLocalSlot(raw.end, plan.zone),
    };
    if (aligned.end <= aligned.start) {
      // Smaller than a slot once aligned — a stray tap inside the plan. Dropping
      // it is right; it is not an error, because the person did not mean
      // anything by it.
      continue;
    }

    const pieces = days
      .map((day) => intersect(day, aligned as Interval))
      .filter((piece): piece is Interval => piece !== null);

    // In the plan's date range but only in the hours between two daily bands —
    // an overnight sliver, say. Nothing survives, and nothing was meant.
    if (pieces.length === 0) continue;
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

/**
 * Whether the **whole** window sits inside one of the plan's daily bands.
 *
 * Containment, not overlap. As an exported predicate this reads as a validity
 * check, and a window that merely clips the edge of a band — or spans overnight
 * between two of them — is not valid availability: part of it is time the plan
 * never asked about. `normaliseWindows` is what turns an overlapping window
 * into contained ones.
 */
export function isWithinPlan(window: Interval, plan: Plan): boolean {
  return planDays(plan).some((day) => contains(day, window));
}

/** Whether any part of the window falls inside the plan. */
export function overlapsPlan(window: Interval, plan: Plan): boolean {
  return planDays(plan).some((day) => intersect(day, window) !== null);
}

/** The day a moment belongs to, as one of the plan's day spans. */
export function dayOf(plan: Plan, at: Instant): Interval | undefined {
  return planDays(plan).find((day) => at >= day.start && at < day.end);
}
