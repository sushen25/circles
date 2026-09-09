/**
 * The painter's grid (spec §5.5, architecture §11).
 *
 * **One cell is thirty minutes** (ADR 0009). Ten of them is exactly the 5-hour
 * evening band and nothing like a 13.5-hour weekend day, so the count varies
 * and the row scrolls, rather than a cell stretching to 81 minutes so that ten
 * fit. A cell meaning different amounts of time on different rows of the same
 * plan is the thing that was avoided.
 *
 * That means **the number of cells varies by day** — ten for a weekday evening,
 * twenty-seven for a weekend day. Ten is a viewport, not a data shape, so it
 * belongs to the UI and not here. A `boolean[]` whose length is
 * `cellCount(plan)` is the contract.
 */

import type { Plan } from '../planning/types.js';
import { SLOT_MINUTES, type Interval, intersect, interval, merge } from '../shared/interval.js';
import { addMinutes, earliest } from '../shared/instant.js';
import type { LocalDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';

/**
 * How many half-hour cells a day of this plan nominally has.
 *
 * Nominal because on the day the clocks go forward some of them do not exist —
 * see `cellAt`. The count stays fixed so cell indices mean the same thing on
 * every day of the window; the missing ones are reported by `cellAt` returning
 * `undefined`.
 */
export function cellCount(plan: Plan): number {
  return Math.floor((plan.daily.endMin - plan.daily.startMin) / SLOT_MINUTES);
}

/** How many cells the UI shows before scrolling. A viewport, not a data shape. */
export const VISIBLE_CELLS = 10;

/**
 * One cell, or `undefined` when that half hour does not exist on that date.
 *
 * Both ends come from local wall-clock boundaries rather than from adding
 * thirty minutes to the start, because on a day the clocks change those are not
 * the same thing. On Melbourne's spring-forward, 02:00 and 02:30 do not happen:
 * deriving the end by addition gave all three of the 02:00, 02:30 and 03:00
 * cells the same interval, so painting one read back as three painted.
 *
 * The end is additionally capped at thirty minutes, which matters on the way
 * back: when the clocks go back, wall-clock 02:30–03:00 spans ninety real
 * minutes. Taking all of it would claim availability across an hour the person
 * never saw on their screen, and this module claims less rather than more.
 */
export function cellAt(date: LocalDate, index: number, plan: Plan): Interval | undefined {
  const startMin = plan.daily.startMin + index * SLOT_MINUTES;
  const start = fromLocal(date, startMin, plan.zone);
  const nextBoundary = fromLocal(date, startMin + SLOT_MINUTES, plan.zone);
  const end = earliest(nextBoundary, addMinutes(start, SLOT_MINUTES));

  // Zero-length: the whole half hour fell in a spring-forward gap.
  if (end <= start) return undefined;
  return interval(start, end);
}

/** Which cells exist on this date. Every index, so the UI can grey the gaps. */
export function cellsFor(date: LocalDate, plan: Plan): (Interval | undefined)[] {
  return Array.from({ length: cellCount(plan) }, (_, index) => cellAt(date, index, plan));
}

/**
 * Painted cells → willing windows. Adjacent cells merge, so painting four in a
 * row offers one two-hour window rather than four half-hour ones — which is
 * what lets the engine find a 90-minute slot across the join.
 */
export function cellsToWindows(date: LocalDate, cells: readonly boolean[], plan: Plan): Interval[] {
  const count = cellCount(plan);
  const painted: Interval[] = [];

  for (let index = 0; index < Math.min(cells.length, count); index += 1) {
    if (cells[index] !== true) continue;
    // A painted cell that does not exist offers nothing, because there is no
    // time to offer. Silently so: the person cannot have meant it.
    const cell = cellAt(date, index, plan);
    if (cell !== undefined) painted.push(cell);
  }
  return merge(painted);
}

/**
 * Willing windows → painted cells, for reopening an answer.
 *
 * A cell is painted when the window covers **all** of it. Partial coverage
 * cannot happen for windows that have been through `normaliseWindows`, and
 * treating it as painted would round availability outward — inventing time
 * nobody offered.
 */
export function windowsToCells(
  date: LocalDate,
  windows: readonly Interval[],
  plan: Plan,
): boolean[] {
  const count = cellCount(plan);
  const cells: boolean[] = [];

  for (let index = 0; index < count; index += 1) {
    const cell = cellAt(date, index, plan);
    if (cell === undefined) {
      cells.push(false);
      continue;
    }
    cells.push(
      windows.some((w) => {
        const overlap = intersect(w, cell);
        return overlap !== null && overlap.start === cell.start && overlap.end === cell.end;
      }),
    );
  }
  return cells;
}
