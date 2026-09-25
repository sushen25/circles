/**
 * **Plan another** (spec §5.9, §6.4): the second plan and after, pre-filled
 * from the last meetup that actually happened, so that it is faster than the
 * first — H6 is tested by exactly that.
 *
 * "Category, duration, quorum, area and a future window from the last
 * happened plan." Each is carried the way it means the same thing next time:
 *
 * - **category** and **duration** as they were;
 * - **quorum** only if the organiser chose it. A defaulted quorum follows the
 *   plan's audience as people join (ADR 0026), and carrying last time's number
 *   would turn a default into a choice nobody made;
 * - **the window** as the same *kind* of window, from now. A plan's dates are
 *   stored rather than its preset, so the kind is read back from their shape:
 *   a weekend alone is **this weekend**, up to a week is **the next 7 days**,
 *   anything longer is **the next 14 days**. A single day is read as the next
 *   7 days rather than as tonight: "tonight" last time is not a reason to ask
 *   about tonight this time, and it is the one preset that can refuse;
 * - **the hours** only when they were chosen: hours equal to what those dates
 *   would have suggested anyway are left to the new window, which suggests its
 *   own. A single day's hours are never carried — tonight's begin at whatever
 *   half hour it was asked.
 *
 * Area belongs to the circle (`default_area`), not to a plan, so it is
 * already the same next time without being carried.
 */

import { type LocalDate, daysBetween, isWeekend, addDays } from '../shared/local-date.js';
import { dailyForRange } from './presets.js';
import type {
  DailyWindow,
  DateWindow,
  DurationMinutes,
  PlanCategory,
  WindowPreset,
} from './types.js';

export type LastPlan = {
  readonly category: PlanCategory;
  readonly durationMinutes: DurationMinutes;
  readonly quorum: number;
  /** `quorum_source = 'chosen'`. */
  readonly quorumChosen: boolean;
  readonly window: DateWindow;
  readonly daily: DailyWindow;
};

export type PlanAnotherDefaults = {
  readonly category: PlanCategory;
  readonly durationMinutes: DurationMinutes;
  /** Undefined: nobody chose, and the server works it out (ADR 0026). */
  readonly quorum: number | undefined;
  readonly preset: Exclude<WindowPreset, 'custom' | 'tonight'>;
  /** Undefined: the new window's own suggestion. */
  readonly daily: DailyWindow | undefined;
};

function allWeekend(start: LocalDate, end: LocalDate): boolean {
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (!isWeekend(date)) return false;
  }
  return true;
}

export function planAnotherDefaults(last: LastPlan): PlanAnotherDefaults {
  const { start, end } = last.window;
  const days = daysBetween(start, end) + 1;
  const preset =
    days <= 2 && allWeekend(start, end)
      ? 'this_weekend'
      : days <= 7
        ? 'next_7_days'
        : 'next_14_days';

  const suggested = dailyForRange(start, end);
  const chosenHours =
    days > 1 &&
    (last.daily.startMin !== suggested.startMin || last.daily.endMin !== suggested.endMin);

  return {
    category: last.category,
    durationMinutes: last.durationMinutes,
    quorum: last.quorumChosen ? last.quorum : undefined,
    preset,
    daily: chosenHours ? last.daily : undefined,
  };
}
