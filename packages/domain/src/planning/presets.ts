/**
 * Window presets (spec §5.3). The point of these is that creating a plan takes
 * under a minute with the defaults accepted — so the defaults have to be the
 * answer most people would have typed.
 *
 * Everything here is computed in the plan's zone. A window is a range of
 * calendar days and a daily band of local times, never an absolute interval:
 * "this weekend, 9 am to 10:30 pm" means the same wall-clock hours on both
 * days, including the day the clocks change.
 */

import { type Instant, isBefore } from '../shared/instant.js';
import { defaultDeadline } from './deadline.js';
import { type LocalDate, addDays, isWeekend, weekday } from '../shared/local-date.js';
import { type Zone, fromLocal, toLocal } from '../shared/zone.js';
import {
  MAX_WINDOW_DAYS,
  type DailyWindow,
  type DateWindow,
  type DurationMinutes,
  type WindowPreset,
} from './types.js';

/** 17:30 and 22:30 as minutes since local midnight. */
const WEEKDAY_EVENING: DailyWindow = { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 };
const WEEKEND_DAY: DailyWindow = { startMin: 9 * 60, endMin: 22 * 60 + 30 };
const LATEST_TONIGHT = 23 * 60 + 30;

export const HALF_HOUR = 30;

/** Round up to the next half hour, because nobody offers to meet at 6:07. */
export function roundUpToHalfHour(minutesOfDay: number): number {
  return Math.ceil(minutesOfDay / HALF_HOUR) * HALF_HOUR;
}

export type PresetWindow = {
  readonly window: DateWindow;
  readonly daily: DailyWindow;
};

/**
 * A band has to be at least as long as the meetup, or `lastPossibleStart` lands
 * before the band opens.
 *
 * **Necessary but not sufficient.** A band can fit the meetup and still produce
 * an impossible plan, because fitting says nothing about *when*: a 17:30–22:30
 * evening comfortably fits two hours, and if today is the only day and it is
 * already 22:00, the last possible start was ninety minutes ago. Use
 * `hasRoomToReply` for the question that actually matters.
 */
export function isViableBand(daily: DailyWindow, durationMinutes: number): boolean {
  return daily.endMin - daily.startMin >= durationMinutes;
}

/**
 * The latest moment the meetup could still begin, for a window that is not yet
 * a `Plan`. `deadline.ts` has the same calculation for one that is.
 */
export function lastStartOf(
  window: DateWindow,
  daily: DailyWindow,
  durationMinutes: number,
  z: Zone,
): Instant {
  return fromLocal(window.end, daily.endMin - durationMinutes, z);
}

/**
 * Whether the meetup could still begin at all.
 *
 * This is the viability test, and it is deliberately the weakest one that is
 * true: a plan whose last possible start has already passed cannot happen, and
 * one with twenty minutes left is merely tight. The spec lets the organiser set
 * a deadline anywhere up to the last possible start (§5.3), so a minimum
 * response time would be a product rule this module has no business inventing.
 */
export function hasFutureStart(
  now: Instant,
  window: DateWindow,
  daily: DailyWindow,
  durationMinutes: number,
  z: Zone,
): boolean {
  return isBefore(now, lastStartOf(window, daily, durationMinutes, z));
}

/**
 * Tonight is the only preset that can fail, and it fails on the duration rather
 * than on the clock alone.
 *
 * At 22:50 there is still half an hour before 23:30 — but not two hours, and a
 * two-hour plan in a thirty-minute band is a plan nobody can attend, with a
 * response deadline that has already passed. The caller should hide or disable
 * the preset rather than substituting a different day: "tonight" meaning
 * tomorrow is a lie.
 */
export function tonight(
  now: Instant,
  z: Zone,
  durationMinutes: DurationMinutes,
): PresetWindow | undefined {
  const local = toLocal(now, z);
  const startMin = roundUpToHalfHour(local.minutesOfDay);
  const daily = { startMin, endMin: LATEST_TONIGHT };
  const window = { start: local.date, end: local.date };

  if (startMin >= LATEST_TONIGHT) return undefined;
  if (!isViableBand(daily, durationMinutes)) return undefined;
  if (!hasFutureStart(now, window, daily, durationMinutes, z)) return undefined;

  // Tonight carries one extra condition, and it is the spec's own rather than
  // an invented minimum: its default deadline is the last possible start less
  // `TONIGHT_MARGIN_MINUTES`, so the preset is only worth offering when that
  // default lands after the plan is created. At 22:30 a one-hour meetup has a
  // last possible start of 22:30 — this instant — and a default deadline half
  // an hour before the plan existed. Offering it produces a plan nobody can
  // answer. Every other preset leaves the deadline entirely to the organiser.
  const lastStart = lastStartOf(window, daily, durationMinutes, z);
  const deadline = defaultDeadline('tonight', now, lastStart);
  if (deadline === undefined || !isBefore(now, deadline)) return undefined;

  return { window, daily };
}

/**
 * The coming Saturday and Sunday. On a Saturday or Sunday it means *this* one,
 * from today — someone asking on Saturday morning means today, not next week.
 */
export function thisWeekend(now: Instant, z: Zone): PresetWindow {
  const today = toLocal(now, z).date;
  const day = weekday(today); // ISO: 1 Monday … 6 Saturday, 7 Sunday

  const SATURDAY = 6;
  const SUNDAY = 7;

  if (day === SATURDAY) {
    return { window: { start: today, end: addDays(today, 1) }, daily: WEEKEND_DAY };
  }
  // On the Sunday the weekend is only what is left of it.
  if (day === SUNDAY) return { window: { start: today, end: today }, daily: WEEKEND_DAY };

  const saturday = addDays(today, SATURDAY - day);
  return { window: { start: saturday, end: addDays(saturday, 1) }, daily: WEEKEND_DAY };
}

/**
 * A rolling window starting today. The daily band follows the majority of days
 * in it — a fortnight is mostly weekdays, so it gets the evening band.
 */
export function nextDays(now: Instant, z: Zone, days: number): PresetWindow {
  const today = toLocal(now, z).date;
  const end = addDays(today, days - 1);
  return { window: { start: today, end }, daily: dailyForRange(today, end) };
}

/** Weekend hours only when every day in the range is a weekend day. */
export function dailyForRange(start: LocalDate, end: LocalDate): DailyWindow {
  let date = start;
  while (date <= end) {
    if (!isWeekend(date)) return WEEKDAY_EVENING;
    date = addDays(date, 1);
  }
  return WEEKEND_DAY;
}

export type PresetError =
  | 'too_late_for_tonight'
  | 'window_too_long'
  | 'window_backwards'
  | 'band_shorter_than_meetup'
  | 'window_has_passed'
  | BandError;

export type PresetOptions = {
  readonly durationMinutes: DurationMinutes;
  /** Required by `custom`: the dates the person picked. */
  readonly custom?: DateWindow | undefined;
  /**
   * An explicit daily band, overriding the preset's default.
   *
   * Spec §5.3 offers a time-of-day window "with preset defaults … ; custom" —
   * the bands the presets suggest are **defaults, not limits**. This was simply
   * never implemented: you could pick custom dates but not custom times, so the
   * defaults acted as a cap and a plan could not ask about a Sunday at four
   * o'clock even though the Candidates artboard shows one.
   */
  readonly daily?: DailyWindow | undefined;
};

export type BandError = 'band_backwards' | 'band_unaligned' | 'band_out_of_day';

/**
 * A band has to run forwards, fit inside a day, and sit on half hours.
 *
 * The half-hour rule is not a restriction on *which* hours — it is the
 * granularity everything else already works in: the painter's cells, the
 * engine's starts, and the willing windows people submit. A band edge at 17:45
 * would put the first cell at 18:00 and quietly lose the quarter hour.
 */
export function validateBand(daily: DailyWindow): BandError | undefined {
  if (daily.endMin <= daily.startMin) return 'band_backwards';
  if (daily.startMin < 0 || daily.endMin > 24 * 60) return 'band_out_of_day';
  if (daily.startMin % HALF_HOUR !== 0 || daily.endMin % HALF_HOUR !== 0) return 'band_unaligned';
  return undefined;
}

/**
 * Resolve a preset to a window, or say why it cannot be one.
 *
 * The duration is not decoration: a band shorter than the meetup produces a
 * plan whose deadline has already passed, so every preset is checked against it
 * rather than only `tonight`. A custom window can be narrow the same way.
 */
export function resolvePreset(
  preset: WindowPreset,
  now: Instant,
  z: Zone,
  options: PresetOptions,
): PresetWindow | PresetError {
  const { durationMinutes, custom, daily } = options;

  const checked = (base: PresetWindow): PresetWindow | PresetError => {
    // An explicit band replaces the preset's suggestion before anything is
    // judged, so the viability checks below apply to what was actually asked
    // for rather than to a default nobody chose.
    let result = base;
    if (daily !== undefined) {
      const invalid = validateBand(daily);
      if (invalid !== undefined) return invalid;
      result = { window: base.window, daily };
    }

    if (!isViableBand(result.daily, durationMinutes)) return 'band_shorter_than_meetup';
    if (!hasFutureStart(now, result.window, result.daily, durationMinutes, z)) {
      return 'window_has_passed';
    }
    return result;
  };

  switch (preset) {
    case 'tonight': {
      const base = tonight(now, z, durationMinutes);
      if (base === undefined) return 'too_late_for_tonight';
      // Tonight's band starts at the next half hour, which an explicit band
      // would otherwise silently move into the past.
      return daily === undefined ? base : checked(base);
    }
    case 'this_weekend':
      return checked(thisWeekend(now, z));
    case 'next_7_days':
      return checked(nextDays(now, z, 7));
    case 'next_14_days':
      return checked(nextDays(now, z, MAX_WINDOW_DAYS));
    case 'custom': {
      if (custom === undefined) return 'window_backwards';
      if (custom.end < custom.start) return 'window_backwards';
      if (windowDays(custom) > MAX_WINDOW_DAYS) return 'window_too_long';
      return checked({ window: custom, daily: dailyForRange(custom.start, custom.end) });
    }
  }
}

/** Inclusive: a single-day window is one day, not zero. */
export function windowDays(window: DateWindow): number {
  let count = 1;
  let date = window.start;
  while (date < window.end) {
    date = addDays(date, 1);
    count += 1;
  }
  return count;
}
