import {
  addDays,
  daysBetween,
  formatMinutesOfDay,
  fromISO,
  fromLocal,
  isDeadlineAllowed,
  localDate,
  toISO,
  toLocal,
  weekday,
  zone as toZone,
  type DurationMinutes,
  type Instant,
  type LocalDate,
  type WindowPreset,
} from '@circles/domain';

import type { GridDay } from '../../components';
import { t } from '../../copy';
import { deviceTimeFormat } from '../../platform/timeFormat';
import { dateWords, dayName, dayNumber } from '../availability/days';
import type { Band, DateRange } from './form';

/**
 * What the first run's second screen works out, apart from the screen: the
 * window chips, the days as a grid, the time of day, the lengths and the reply
 * times Adjust offers (SUS-247). Every rule is the domain's; this is the wiring
 * between its answers and a person's taps.
 */

/** Monthly (the default), the next fortnight, and this weekend. Tonight is the full setup's. */
export const WINDOW_CHIPS = [
  'next_28_days',
  'next_14_days',
  'this_weekend',
] as const satisfies readonly WindowPreset[];
export type WindowChip = (typeof WINDOW_CHIPS)[number];

export function windowChipLabel(chip: WindowChip): string {
  switch (chip) {
    case 'next_28_days':
      return t('firstRun', 'window_monthly');
    case 'next_14_days':
      return t('firstRun', 'window_fortnight');
    case 'this_weekend':
      return t('firstRun', 'window_weekend');
  }
}

/** The lengths Adjust offers; the rest are in the full setup. */
export const LENGTHS: readonly DurationMinutes[] = [60, 90, 120, 180];

export function lengthLabel(duration: DurationMinutes): string {
  switch (duration) {
    case 60:
      return t('firstRun', 'about_an_hour');
    case 90:
      return t('firstRun', 'about_90_minutes');
    case 180:
      return t('firstRun', 'about_3_hours');
    default:
      return t('firstRun', 'about_2_hours');
  }
}

/** Weekday evenings, 5:30 to 10:30 pm: what a month or a fortnight suggests. */
export const EVENINGS: Band = { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 };
/** The weekend's own hours, 9 am to 10:30 pm. */
export const DAYS_AND_EVENINGS: Band = { startMin: 9 * 60, endMin: 22 * 60 + 30 };

export type TimeOfDay = 'evenings' | 'days';

/** Which of the two a band is: from five o'clock on is evenings, anything earlier is days. */
export function timeOfDay(band: Band): TimeOfDay {
  return band.startMin >= 17 * 60 ? 'evenings' : 'days';
}

export function bandOf(choice: TimeOfDay): Band {
  return choice === 'evenings' ? EVENINGS : DAYS_AND_EVENINGS;
}

/** "5:30–10:30 pm", on the device's clock. */
export function bandHours(band: Band): string {
  const format = deviceTimeFormat();
  return `${formatMinutesOfDay(band.startMin, format)}–${formatMinutesOfDay(band.endMin, format)}`;
}

/**
 * Whether the answer is "evenings" (a weekday evening) or "days". A weekend is
 * always days, as the prototype has it, whatever hours it is asked in.
 */
export function unitOf(preset: WindowPreset, band: Band): 'evening' | 'day' {
  return preset !== 'this_weekend' && timeOfDay(band) === 'evenings' ? 'evening' : 'day';
}

export function headingFor(preset: WindowPreset, band: Band): string {
  if (preset === 'this_weekend') return t('firstRun', 'heading_weekend');
  return timeOfDay(band) === 'evenings'
    ? t('firstRun', 'heading_evenings')
    : t('firstRun', 'heading_days');
}

/** Every day the window asks about, in order. */
export function daysOf(range: DateRange): string[] {
  if (range.days !== undefined) return [...range.days];
  const days: string[] = [];
  for (let date: LocalDate = localDate(range.start); date <= range.end; date = addDays(date, 1)) {
    days.push(date);
  }
  return days;
}

/** The first day of a month in short words, for the day that begins one: "Nov". */
function monthShort(date: LocalDate): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/**
 * The window as a grid, Monday first, a day's column by its weekday. A day is
 * ticked with a check as well as the fill, and spoken as "Thursday 22 October,
 * evening" so nobody has to see the colour. No day carries a "Today" tag.
 */
export function gridDays(
  days: readonly string[],
  picked: ReadonlySet<string>,
  unit: 'evening' | 'day',
): GridDay[] {
  const first = days[0];
  if (first === undefined) return [];
  const monday = addDays(localDate(first), -(weekday(localDate(first)) - 1));
  return days.map((date) => {
    const day = localDate(date);
    const spoken = dateWords(day, 'long');
    return {
      key: date,
      number: dayNumber(day),
      name: dayName(day),
      label:
        unit === 'evening'
          ? t('firstRun', 'day_evening', { day: spoken })
          : t('firstRun', 'day_whole', { day: spoken }),
      slot: daysBetween(monday, day),
      selected: picked.has(date),
      hasTimes: false,
      ...(date.endsWith('-01') ? { tag: monthShort(day) } : {}),
    };
  });
}

/** "Sun 6 pm": the weekday and the time, all that "replies close" needs on one line. */
export function closesShort(iso: string, zone: string): string {
  const z = toZone(zone);
  const at = fromISO(iso);
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: zone }).format(
    new Date(iso),
  );
  return `${day} ${formatMinutesOfDay(toLocal(at, z).minutesOfDay, deviceTimeFormat())}`;
}

/**
 * The reply times Adjust offers: the default's own day at 6 pm, and the day
 * either side of it, as far as each is a time replies can still close
 * (`isDeadlineAllowed`: after now, never past the last possible start). The
 * default is always one of them.
 */
export function replyChoices(
  defaultIso: string,
  latestStartIso: string,
  zone: string,
  now: Instant,
): string[] {
  const z = toZone(zone);
  const base = toLocal(fromISO(defaultIso), z);
  const choices = [-1, 0, 1].flatMap((shift) => {
    const at =
      shift === 0
        ? fromISO(defaultIso)
        : fromLocal(addDays(base.date, shift), base.minutesOfDay, z);
    return shift === 0 || isDeadlineAllowed(at, fromISO(latestStartIso), now) ? [toISO(at)] : [];
  });
  return choices;
}
