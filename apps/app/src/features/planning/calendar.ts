import {
  MAX_WINDOW_DAYS,
  addDays,
  daysBetween,
  fromParts,
  localDate,
  toParts,
  weekday,
  windowFromDays,
  type LocalDate,
} from '@circles/domain';

import type { DateRange } from './form';

/**
 * The CustomWindow month grid (spec §5.3, ADR 00ZZ): the days to ask about,
 * picked one at a time or painted in a stroke.
 *
 * A tap toggles a day. A stroke — a drag that starts on a day — gives every
 * day from where it started to where the finger is now the opposite of what
 * the first day was, **in calendar order**, so dragging from Mon 14 down to
 * Sun 27 picks the fortnight in one go; dragging back shrinks it. Days already
 * gone, and Change the time's day that is off the table, are never picked.
 *
 * **The cap is a span.** The first and last day picked may be up to thirty
 * days apart (ADR 0030), so a plan never asks about more than thirty days.
 * Once something is picked, a day outside that reach is faded and says why;
 * a stroke stops where the reach ends.
 *
 * The selection is a sorted list of `YYYY-MM-DD` strings, which compare as
 * dates do.
 */
export type Selection = readonly string[];

export type MonthDay = {
  date: string;
  /** Monday-first column, counted from the first of the month's week. */
  slot: number;
  selected: boolean;
  disabled: boolean;
  /**
   * `past`: gone. `off`: before the first day this window may use — Change
   * the time's, which starts after the day it takes off the table.
   * `too_far`: more than thirty days from a day already picked.
   */
  why: 'past' | 'off' | 'too_far' | undefined;
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

const sorted = (days: Iterable<string>): string[] => [...new Set(days)].sort();

/**
 * Whether a day may join the selection without the first and last picked
 * being more than thirty days apart.
 */
export function withinReach(selection: Selection, date: string): boolean {
  const first = selection[0];
  const last = selection[selection.length - 1];
  if (first === undefined || last === undefined) return true;
  const from = date < first ? date : first;
  const to = date > last ? date : last;
  return daysBetween(localDate(from), localDate(to)) + 1 <= MAX_WINDOW_DAYS;
}

/** A tap: the day goes if it was picked, and joins if it is within reach. */
export function toggleDay(selection: Selection, date: string): string[] {
  if (selection.includes(date)) return selection.filter((day) => day !== date);
  if (!withinReach(selection, date)) return [...selection];
  return sorted([...selection, date]);
}

/**
 * A stroke from `anchor` to `current`, applied to the selection as it was when
 * the stroke began (`base`), so dragging back undoes what dragging forward did.
 * `paint` is the opposite of what the anchor was. `pickable` says which days a
 * stroke may touch at all; a painting stroke stops at the first day out of
 * reach, because everything past it is further still.
 */
export function applyStroke(
  base: Selection,
  anchor: string,
  current: string,
  paint: boolean,
  pickable: (date: string) => boolean,
): string[] {
  const next = new Set(base);
  const step = current >= anchor ? 1 : -1;
  for (let date = anchor; ; date = addDays(localDate(date), step)) {
    if (pickable(date)) {
      if (!paint) next.delete(date);
      else if (withinReach(sorted(next), date)) next.add(date);
      else break;
    }
    if (date === current) break;
  }
  return sorted(next);
}

/** Runs of consecutive days, for saying the selection in words. */
export function runsOf(selection: Selection): DateRange[] {
  const runs: DateRange[] = [];
  for (const date of selection) {
    const last = runs[runs.length - 1];
    if (last !== undefined && addDays(localDate(last.end), 1) === date) last.end = date;
    else runs.push({ start: date, end: date });
  }
  return runs;
}

/**
 * The window a selection stands for: first and last, and the days between
 * only when there are gaps (`windowFromDays`, the domain's one form).
 */
export function rangeOf(selection: Selection): DateRange | undefined {
  const window = windowFromDays(selection.map(localDate));
  if (window === undefined) return undefined;
  return window.days === undefined
    ? { start: window.start, end: window.end }
    : { start: window.start, end: window.end, days: [...window.days] };
}

/** Every day a range asks about: its days, or each from its start to its end. */
export function selectionOf(range: DateRange | undefined): string[] {
  if (range === undefined) return [];
  if (range.days !== undefined) return sorted(range.days);
  const days: string[] = [];
  for (let date = range.start; date <= range.end; date = addDays(localDate(date), 1)) {
    days.push(date);
  }
  return days;
}

export function monthDays(
  first: string,
  today: string,
  selection: Selection,
  notBefore?: string | undefined,
): MonthDay[] {
  const start = localDate(first);
  const { month } = toParts(start);
  const offset = weekday(start) - 1; // ISO: Monday 1 … Sunday 7
  const picked = new Set(selection);

  const days: MonthDay[] = [];
  for (let date: LocalDate = start, i = 0; toParts(date).month === month; i += 1) {
    const past = date < today;
    const off = !past && notBefore !== undefined && date < notBefore;
    const selected = picked.has(date);
    const tooFar = !past && !off && !selected && !withinReach(selection, date);
    days.push({
      date,
      slot: offset + i,
      selected,
      disabled: past || off || tooFar,
      why: past ? 'past' : off ? 'off' : tooFar ? 'too_far' : undefined,
    });
    date = addDays(date, 1);
  }
  return days;
}
