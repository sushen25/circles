/**
 * The painter's grid (spec §5.5, architecture §11).
 *
 * **One cell is thirty minutes.** The spec describes "ten half-hour cells
 * across the daily window", which is exact for the 5-hour evening band and
 * cannot be for a 13.5-hour weekend day. The ticket settled it: keep 30-minute
 * cells and let the day row scroll horizontally, rather than stretching a cell
 * to 81 minutes so that ten of them fit.
 *
 * That means **the number of cells varies by day** — ten for a weekday evening,
 * twenty-seven for a weekend day. Ten is a viewport, not a data shape, so it
 * belongs to the UI and not here. A `boolean[]` whose length is
 * `cellCount(plan)` is the contract.
 */

import type { Plan } from '../planning/types.js';
import { SLOT_MINUTES, type Interval, intersect, interval, merge } from '../shared/interval.js';
import { addMinutes } from '../shared/instant.js';
import type { LocalDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';

/** How many half-hour cells a day of this plan has. */
export function cellCount(plan: Plan): number {
  return Math.floor((plan.daily.endMin - plan.daily.startMin) / SLOT_MINUTES);
}

/** How many cells the UI shows before scrolling. A viewport, not a data shape. */
export const VISIBLE_CELLS = 10;

function cellAt(date: LocalDate, index: number, plan: Plan): Interval {
  const start = fromLocal(date, plan.daily.startMin + index * SLOT_MINUTES, plan.zone);
  return interval(start, addMinutes(start, SLOT_MINUTES));
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
    if (cells[index] === true) painted.push(cellAt(date, index, plan));
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
    cells.push(
      windows.some((w) => {
        const overlap = intersect(w, cell);
        return overlap !== null && overlap.start === cell.start && overlap.end === cell.end;
      }),
    );
  }
  return cells;
}
