import {
  type Instant,
  type Zone,
  formatMinutesOfDay,
  formatRange,
  toLocal,
  toParts,
  weekday as isoWeekday,
} from '@circles/domain';

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
