/**
 * Which days a plan asks about (ADR 0047).
 *
 * A window is its first and last day, and — when it has gaps — the days in
 * between that it asks about. **No days means every day from the first to the
 * last**, which is what every preset makes and what every plan stored before
 * specific days existed is. So a window with gaps carries its days, and one
 * without carries none: `windowFromDays` writes it that way, and the database
 * keeps the same canonical form (`plan_days` has rows only for a plan with
 * gaps).
 *
 * Everything that walks a plan's dates calls `askedDays`, so the engine, the
 * availability editor and the database's own check cannot disagree about
 * whether a Wednesday is in the plan.
 */

import { type LocalDate, addDays, daysBetween } from '../shared/local-date.js';
import { MAX_WINDOW_DAYS, type DateWindow } from './types.js';

/** Every date the window asks about, in order. */
export function askedDays(window: DateWindow): LocalDate[] {
  if (window.days !== undefined) return [...window.days];
  const days: LocalDate[] = [];
  for (let date = window.start; date <= window.end; date = addDays(date, 1)) days.push(date);
  return days;
}

/** Whether a date is one the window asks about. */
export function asksAbout(window: DateWindow, date: LocalDate): boolean {
  if (date < window.start || date > window.end) return false;
  return window.days === undefined || window.days.includes(date);
}

/** How many days are asked about: the count a person is shown, not the span. */
export function askedDayCount(window: DateWindow): number {
  return window.days?.length ?? daysBetween(window.start, window.end) + 1;
}

/** Whether some day between the first and the last is not asked about. */
export function hasGaps(window: DateWindow): boolean {
  return askedDayCount(window) < daysBetween(window.start, window.end) + 1;
}

/**
 * The window a set of picked days stands for, in its one canonical form: first
 * and last, and the days only when there are gaps. Order and repeats in the
 * input do not matter; an empty set is no window.
 */
export function windowFromDays(picked: readonly LocalDate[]): DateWindow | undefined {
  const days = [...new Set(picked)].sort();
  const start = days[0];
  const end = days[days.length - 1];
  if (start === undefined || end === undefined) return undefined;
  const contiguous = daysBetween(start, end) + 1 === days.length;
  return contiguous ? { start, end } : { start, end, days };
}

export type DaysError =
  | 'window_backwards'
  | 'window_too_long'
  /** Unsorted, repeated, outside the window, or not ending on its ends. */
  | 'days_invalid';

/**
 * Whether a window is well formed: forwards, at most thirty days from first to
 * last (ADR 0030, which this keeps: the cap is a span), and, if it lists its
 * days, sorted, distinct, inside it and starting and ending on its ends. The
 * database refuses the same shapes (`planning.days_invalid`).
 */
export function windowError(window: DateWindow): DaysError | undefined {
  if (window.end < window.start) return 'window_backwards';
  if (daysBetween(window.start, window.end) + 1 > MAX_WINDOW_DAYS) return 'window_too_long';
  const days = window.days;
  if (days === undefined) return undefined;
  if (days.length === 0) return 'days_invalid';
  if (days[0] !== window.start || days[days.length - 1] !== window.end) return 'days_invalid';
  for (let i = 1; i < days.length; i += 1) {
    if (days[i]! <= days[i - 1]!) return 'days_invalid';
  }
  return undefined;
}

/** The same days asked about, however each window happens to be written. */
export function sameDays(a: DateWindow, b: DateWindow): boolean {
  const left = askedDays(a);
  const right = askedDays(b);
  return left.length === right.length && left.every((date, index) => date === right[index]);
}

/**
 * What changing a plan's days does to its answers (ADR 0047).
 *
 * - `same`: nothing to say.
 * - `narrow`: days were only taken away, and nobody had picked any of them.
 *   Every answer still means what it meant, so the plan keeps its revision.
 * - `reask`: a day was added, or a day somebody picked was taken away. That is
 *   a new question (ADR 0017), and everybody is asked again.
 *
 * `picked` is every day somebody's answer to the current revision has times
 * on — the editor's own included, because their answer is cleared like
 * anybody's. Only the server can see it; `public.revise_plan` decides this
 * same way under the plan's lock, and the preview asks it.
 */
export type DaysChange = 'same' | 'narrow' | 'reask';

export function daysChange(
  before: DateWindow,
  after: DateWindow,
  picked: readonly LocalDate[],
): DaysChange {
  const was = askedDays(before);
  const now = askedDays(after);
  const added = now.some((date) => !was.includes(date));
  const removed = was.filter((date) => !now.includes(date));
  if (!added && removed.length === 0) return 'same';
  if (added || removed.some((date) => picked.includes(date))) return 'reask';
  return 'narrow';
}

/**
 * "Try a wider window" (spec §5.6, ADR 0030): every day for thirty days from
 * the first, whatever gaps the plan had. The preview says the gaps go.
 */
export function widestFrom(window: DateWindow): DateWindow {
  return { start: window.start, end: addDays(window.start, MAX_WINDOW_DAYS - 1) };
}

/**
 * Runs of consecutive days, for saying a set of days in words:
 * "Thu 17 – Sun 20 Sep, Tue 22 Sep" is two runs.
 */
export function dayRuns(window: DateWindow): { start: LocalDate; end: LocalDate }[] {
  const runs: { start: LocalDate; end: LocalDate }[] = [];
  for (const date of askedDays(window)) {
    const last = runs[runs.length - 1];
    if (last !== undefined && addDays(last.end, 1) === date) last.end = date;
    else runs.push({ start: date, end: date });
  }
  return runs;
}

/**
 * The span from first day to last, inclusive: a single-day window is one day,
 * not zero. With gaps this is not how many days are asked about —
 * `askedDayCount` is (ADR 0047).
 */
export function windowDays(window: DateWindow): number {
  return daysBetween(window.start, window.end) + 1;
}
