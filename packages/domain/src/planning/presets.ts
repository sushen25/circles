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

import type { Instant } from '../shared/instant.js';
import { type LocalDate, addDays, isWeekend, weekday } from '../shared/local-date.js';
import { type Zone, toLocal } from '../shared/zone.js';
import { MAX_WINDOW_DAYS, type DailyWindow, type DateWindow, type WindowPreset } from './types.js';

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
 * Tonight is the only preset that can fail: after 23:00 local there is no
 * half-hour band left before 23:30, and offering one would produce a plan
 * nobody can attend. The caller should hide or disable the preset rather than
 * substituting a different day — "tonight" meaning tomorrow is a lie.
 */
export function tonight(now: Instant, z: Zone): PresetWindow | undefined {
  const local = toLocal(now, z);
  const startMin = roundUpToHalfHour(local.minutesOfDay);
  if (startMin >= LATEST_TONIGHT) return undefined;

  return {
    window: { start: local.date, end: local.date },
    daily: { startMin, endMin: LATEST_TONIGHT },
  };
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

export type PresetError = 'too_late_for_tonight' | 'window_too_long' | 'window_backwards';

/**
 * Resolve a preset to a window. `custom` needs the dates the person picked and
 * is capped at 14 consecutive days (spec §5.3).
 */
export function resolvePreset(
  preset: WindowPreset,
  now: Instant,
  z: Zone,
  custom?: DateWindow,
): PresetWindow | PresetError {
  switch (preset) {
    case 'tonight':
      return tonight(now, z) ?? 'too_late_for_tonight';
    case 'this_weekend':
      return thisWeekend(now, z);
    case 'next_7_days':
      return nextDays(now, z, 7);
    case 'next_14_days':
      return nextDays(now, z, MAX_WINDOW_DAYS);
    case 'custom': {
      if (custom === undefined) return 'window_backwards';
      if (custom.end < custom.start) return 'window_backwards';
      if (windowDays(custom) > MAX_WINDOW_DAYS) return 'window_too_long';
      return { window: custom, daily: dailyForRange(custom.start, custom.end) };
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
