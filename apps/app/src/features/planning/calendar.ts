import {
  MAX_WINDOW_DAYS,
  addDays,
  fromParts,
  localDate,
  toParts,
  weekday,
  windowDays,
  type LocalDate,
} from '@circles/domain';

import type { DateRange } from './form';

/**
 * The CustomWindow month grid (spec §5.3: "custom (calendar picker, capped at
 * 14 consecutive days)").
 *
 * Two taps make a range: the first picks the start, the second the end. A
 * second tap before the start, or past the cap, starts again from the day
 * tapped rather than refusing — the person meant *that* day. Days already
 * gone are shown and cannot be picked. While an end is being chosen, the
 * screen names the last day the cap allows, and a day past it says so when
 * it is read aloud; it stays tappable, because tapping it means "start
 * here instead".
 */
export type Pick = { start: string | undefined; end: string | undefined };

export type MonthDay = {
  date: string;
  /** Monday-first column, counted from the first of the month's week. */
  slot: number;
  selected: boolean;
  disabled: boolean;
  why: 'past' | 'too_far' | undefined;
};

/** The first of the month a date is in. */
export function monthOf(date: string): string {
  const { year, month } = toParts(localDate(date));
  return fromParts(year, month, 1);
}

/** The first of the next (+1) or previous (−1) month. */
export function shiftMonth(first: string, by: 1 | -1): string {
  const { year, month } = toParts(localDate(first));
  const index = year * 12 + (month - 1) + by;
  return fromParts(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function tapDay(pick: Pick, date: string): Pick {
  const { start, end } = pick;
  if (start === undefined || end !== undefined) return { start: date, end: undefined };
  if (date < start) return { start: date, end: undefined };
  if (windowDays({ start: localDate(start), end: localDate(date) }) > MAX_WINDOW_DAYS) {
    return { start: date, end: undefined };
  }
  return { start, end: date };
}

/** The last day an end can be while one is being chosen: fourteen days in all. */
export function lastEnd(pick: Pick): string | undefined {
  if (pick.start === undefined || pick.end !== undefined) return undefined;
  return addDays(localDate(pick.start), MAX_WINDOW_DAYS - 1);
}

/** The range a pick stands for: a single day is a one-day window. */
export function rangeOf(pick: Pick): DateRange | undefined {
  if (pick.start === undefined) return undefined;
  return { start: pick.start, end: pick.end ?? pick.start };
}

export function monthDays(first: string, today: string, pick: Pick): MonthDay[] {
  const start = localDate(first);
  const { month } = toParts(start);
  const offset = weekday(start) - 1; // ISO: Monday 1 … Sunday 7
  const range = rangeOf(pick);
  const cap = lastEnd(pick);

  const days: MonthDay[] = [];
  for (let date: LocalDate = start, i = 0; toParts(date).month === month; i += 1) {
    const past = date < today;
    const tooFar = cap !== undefined && date > cap;
    days.push({
      date,
      slot: offset + i,
      selected: range !== undefined && date >= range.start && date <= range.end,
      disabled: past,
      why: past ? 'past' : tooFar ? 'too_far' : undefined,
    });
    date = addDays(date, 1);
  }
  return days;
}
