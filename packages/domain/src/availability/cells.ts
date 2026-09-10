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
import { type Interval, intersect, interval, merge } from '../shared/interval.js';
import type { LocalDate } from '../shared/local-date.js';
import { instant } from '../shared/instant.js';
import { ceilToLocalSlot, fromLocal } from '../shared/zone.js';

/**
 * Every half-hour slot the day's band actually contains, in order.
 *
 * Enumerated from the band rather than computed from an index, because the
 * number of real half hours in a wall-clock band is not fixed. On the day the
 * clocks go forward some do not happen; on the day they go back, 02:00 and
 * 02:30 happen twice and **both are real time somebody can be free during**.
 *
 * An earlier version had one cell per nominal local time, which meant the
 * repeated hour shared a row with its first occurrence. A window on the second
 * 02:00 then matched no cell, so reopening a saved response showed nothing
 * painted and quietly discarded it. Giving each occurrence its own cell is what
 * makes the painter and `normaliseWindows` agree about what exists.
 */
export function cellsFor(date: LocalDate, plan: Plan): Interval[] {
  const bandStart = fromLocal(date, plan.daily.startMin, plan.zone);
  const bandEnd = fromLocal(date, plan.daily.endMin, plan.zone);

  const cells: Interval[] = [];
  let at = bandStart;
  while (at < bandEnd) {
    // The next moment whose local clock reads a half hour. Adding a millisecond
    // first makes it strictly later, and `ceilToLocalSlot` keeps the occurrence.
    const next = ceilToLocalSlot(instant(at + 1), plan.zone);
    const end = next < bandEnd ? next : bandEnd;
    if (end <= at) break; // defensive: the band cannot be walked
    cells.push(interval(at, end));
    at = end;
  }
  return cells;
}

/**
 * How many cells this day has.
 *
 * Takes the date because the answer depends on it: ten for a weekday evening,
 * twenty-seven for a weekend day (ADR 0009), and two more or two fewer on the
 * days a clock changes.
 */
export function cellCount(date: LocalDate, plan: Plan): number {
  return cellsFor(date, plan).length;
}

/** How many cells the UI shows before scrolling. A viewport, not a data shape. */
export const VISIBLE_CELLS = 10;

/** One cell, or `undefined` when the day has no cell at that index. */
export function cellAt(date: LocalDate, index: number, plan: Plan): Interval | undefined {
  return cellsFor(date, plan)[index];
}

/**
 * Painted cells → willing windows. Adjacent cells merge, so painting four in a
 * row offers one two-hour window rather than four half-hour ones — which is
 * what lets the engine find a 90-minute slot across the join.
 */
export function cellsToWindows(date: LocalDate, cells: readonly boolean[], plan: Plan): Interval[] {
  const dayCells = cellsFor(date, plan);
  const painted: Interval[] = [];

  for (let index = 0; index < Math.min(cells.length, dayCells.length); index += 1) {
    const cell = dayCells[index];
    if (cells[index] === true && cell !== undefined) painted.push(cell);
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
  return cellsFor(date, plan).map((cell) =>
    windows.some((w) => {
      const overlap = intersect(w, cell);
      return overlap !== null && overlap.start === cell.start && overlap.end === cell.end;
    }),
  );
}
