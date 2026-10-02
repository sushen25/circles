import {
  type Instant,
  type LocalDate,
  type Zone,
  dayRuns,
  formatMinutesOfDay,
  formatRange,
  toLocal,
  toParts,
  weekday as isoWeekday,
} from '@circles/domain';

import { EN_DAYS } from './copy-days.ts';

/**
 * Dates as an email writes them, in the plan's zone.
 *
 * The names are spelled out here rather than taken from `Intl`, because the two
 * runtimes that render these disagree: Node and Deno ship different ICU data,
 * and "Thu 17 Sep" in one is "Thu, 17 Sept" in the other. A snapshot test that
 * passes in Node and an email that reads differently from Deno would be the
 * worst of both. The clock arithmetic is the domain's (`toLocal`,
 * `formatRange`), so this file only names things.
 *
 * English only, like the copy beside it. A second language would pass a second
 * set of names, the way `ShareDateFormat` is passed.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parts(value: Instant, zone: Zone) {
  const local = toLocal(value, zone);
  const { month, day } = toParts(local.date);
  return {
    weekday: WEEKDAYS[isoWeekday(local.date) - 1] ?? '',
    month: MONTHS[month - 1] ?? '',
    day,
    minutesOfDay: local.minutesOfDay,
  };
}

/** "Thursday" */
export function weekdayName(value: Instant, zone: Zone): string {
  return parts(value, zone).weekday;
}

/** "Thu 17 Sep" — the date in a subject line. */
export function shortDate(value: Instant, zone: Zone): string {
  const p = parts(value, zone);
  return `${p.weekday.slice(0, 3)} ${p.day} ${p.month.slice(0, 3)}`;
}

/** "Thursday 17 September" — the date as the email's headline. */
export function longDate(value: Instant, zone: Zone): string {
  const p = parts(value, zone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "6:30 pm" */
export function clockTime(value: Instant, zone: Zone): string {
  return formatMinutesOfDay(parts(value, zone).minutesOfDay);
}

/** "6:30–8:30 pm", reading a meetup that ends at midnight as ending at midnight. */
export function timeRange(start: Instant, end: Instant, zone: Zone): string {
  const from = toLocal(start, zone);
  const to = toLocal(end, zone);
  const endMin = to.date === from.date ? to.minutesOfDay : to.minutesOfDay + 24 * 60;
  return formatRange(from.minutesOfDay, endMin);
}

/**
 * "tonight" or "today", for a reminder sent two hours before.
 *
 * A reminder for a ten o'clock brunch that said "tonight" would be wrong in
 * the one line people read. Five in the afternoon is where evening starts.
 */
export function todayOrTonight(value: Instant, zone: Zone): 'today' | 'tonight' {
  return parts(value, zone).minutesOfDay >= 17 * 60 ? 'tonight' : 'today';
}

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** "five" — a circle holds at most twenty (ADR 0012), so words cover it. */
export function countInWords(value: number): string {
  return WORDS[value] ?? String(value);
}

/** "Thu 17 Sep" for a calendar date, with no instant or zone to it. */
function dayOf(date: LocalDate): { weekday: string; day: number; month: string } {
  const { month, day } = toParts(date);
  return {
    weekday: (WEEKDAYS[isoWeekday(date) - 1] ?? '').slice(0, 3),
    day,
    month: (MONTHS[month - 1] ?? '').slice(0, 3),
  };
}

/**
 * "Thu 17 – Sun 20 Sep", "Wed 30 Sep – Sat 3 Oct", or "Thu 17 Sep" for one day:
 * a plan's window as a person writes it, the month once when it is shared.
 */
export function dateSpan(start: LocalDate, end: LocalDate): string {
  const from = dayOf(start);
  const to = dayOf(end);
  const last = `${to.weekday} ${to.day} ${to.month}`;
  if (start === end) return last;
  return from.month === to.month
    ? `${from.weekday} ${from.day} – ${last}`
    : `${from.weekday} ${from.day} ${from.month} – ${last}`;
}

/**
 * A plan's days as a person writes them (ADR 0047). Every day from the first
 * to the last is `dateSpan`'s "Thu 17 – Sun 20 Sep"; with gaps, each run of
 * days is said that way and the runs are listed — "Thu 17 – Sat 19 Sep, Tue 22
 * Sep and Thu 24 Sep" — so the letter never claims a day the plan skips. More
 * than three runs is a count rather than a list nobody reads to the end.
 */
export function daysSpan(
  start: LocalDate,
  end: LocalDate,
  days?: readonly LocalDate[] | undefined,
): string {
  if (days === undefined || days.length === 0) return dateSpan(start, end);
  const runs = dayRuns({ start, end, days });
  if (runs.length > 3) {
    return EN_DAYS.between({
      count: days.length,
      from: dateSpan(start, start),
      to: dateSpan(end, end),
    });
  }
  return EN_DAYS.list(runs.map((run) => dateSpan(run.start, run.end)));
}

/** "5:30–10:30 pm": a plan's daily band, in minutes of the local day. */
export function hoursSpan(startMin: number, endMin: number): string {
  return formatRange(startMin, endMin);
}
