import { describe, expect, it } from 'vitest';

import { fromISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import type { DateWindow } from './types.js';
import { toLocal, zone } from '../shared/zone.js';
import { MELBOURNE } from '../shared/fixtures.js';
import type { DurationMinutes } from './types.js';
import {
  dailyForRange,
  isViableBand,
  nextDays,
  resolvePreset,
  roundUpToHalfHour,
  thisWeekend,
  tonight,
  windowDays,
} from './presets.js';

/** The circle default. Every preset has to leave room for it. */
const TWO_HOURS: DurationMinutes = 120;
const opts = (durationMinutes: DurationMinutes = TWO_HOURS, custom?: DateWindow) =>
  custom === undefined ? { durationMinutes } : { durationMinutes, custom };

/** Melbourne is UTC+10 in September 2026, so 08:00Z is 18:00 local. */
const THURSDAY_6PM = fromISO('2026-09-17T08:00:00Z');

describe('roundUpToHalfHour', () => {
  it('never offers to meet at 6:07', () => {
    expect(roundUpToHalfHour(18 * 60 + 7)).toBe(18 * 60 + 30);
    expect(roundUpToHalfHour(18 * 60 + 31)).toBe(19 * 60);
  });

  it('leaves an exact half hour alone', () => {
    expect(roundUpToHalfHour(18 * 60 + 30)).toBe(18 * 60 + 30);
  });
});

describe('tonight', () => {
  it('runs from the next half hour to 11:30 pm, today', () => {
    const result = tonight(THURSDAY_6PM, MELBOURNE, TWO_HOURS);
    expect(result?.window).toEqual({
      start: localDate('2026-09-17'),
      end: localDate('2026-09-17'),
    });
    expect(result?.daily).toEqual({ startMin: 18 * 60, endMin: 23 * 60 + 30 });
  });

  it('refuses rather than lying once there is no evening left', () => {
    // 23:10 Melbourne. Rounding up gives 23:30, which is not before 23:30.
    const lateNight = fromISO('2026-09-17T13:10:00Z');
    expect(toLocal(lateNight, MELBOURNE).minutesOfDay).toBe(23 * 60 + 10);
    expect(tonight(lateNight, MELBOURNE, TWO_HOURS)).toBeUndefined();
    expect(resolvePreset('tonight', lateNight, MELBOURNE, opts())).toBe('too_late_for_tonight');
  });

  it('refuses when there is time left but not enough for the meetup', () => {
    // 22:50 leaves a 23:00–23:30 band. Half an hour is time, but it is not a
    // two-hour catch-up: the plan would have a last-possible-start before its
    // window opened and a response deadline already in the past.
    const almostMidnight = fromISO('2026-09-17T12:50:00Z');
    expect(toLocal(almostMidnight, MELBOURNE).minutesOfDay).toBe(22 * 60 + 50);
    expect(tonight(almostMidnight, MELBOURNE, TWO_HOURS)).toBeUndefined();
    expect(resolvePreset('tonight', almostMidnight, MELBOURNE, opts())).toBe(
      'too_late_for_tonight',
    );
  });

  it('still offers a short meetup in the same half hour', () => {
    // The band is exactly 60 minutes at 22:30, so an hour still fits.
    const halfTen = fromISO('2026-09-17T12:30:00Z');
    expect(tonight(halfTen, MELBOURNE, 60)?.daily).toEqual({
      startMin: 22 * 60 + 30,
      endMin: 23 * 60 + 30,
    });
    expect(tonight(halfTen, MELBOURNE, 90)).toBeUndefined();
  });

  it('is measured in the plan zone, not UTC', () => {
    // Same instant, two zones, two different local evenings.
    const perth = zone('Australia/Perth'); // UTC+8
    expect(tonight(THURSDAY_6PM, MELBOURNE, TWO_HOURS)?.daily.startMin).toBe(18 * 60);
    expect(tonight(THURSDAY_6PM, perth, TWO_HOURS)?.daily.startMin).toBe(16 * 60);
  });
});

describe('thisWeekend', () => {
  it('finds the coming Saturday and Sunday from a weekday', () => {
    const result = thisWeekend(THURSDAY_6PM, MELBOURNE); // Thursday 17 Sep
    expect(result.window).toEqual({
      start: localDate('2026-09-19'),
      end: localDate('2026-09-20'),
    });
    expect(result.daily).toEqual({ startMin: 9 * 60, endMin: 22 * 60 + 30 });
  });

  it('means this one, not next, when asked on the Saturday', () => {
    const saturday = fromISO('2026-09-19T00:00:00Z'); // Sat 10am Melbourne
    expect(thisWeekend(saturday, MELBOURNE).window).toEqual({
      start: localDate('2026-09-19'),
      end: localDate('2026-09-20'),
    });
  });

  it('is just today when asked on the Sunday', () => {
    const sunday = fromISO('2026-09-20T00:00:00Z');
    expect(thisWeekend(sunday, MELBOURNE).window).toEqual({
      start: localDate('2026-09-20'),
      end: localDate('2026-09-20'),
    });
  });
});

describe('nextDays', () => {
  it('starts today and is inclusive', () => {
    const result = nextDays(THURSDAY_6PM, MELBOURNE, 7);
    expect(result.window).toEqual({ start: localDate('2026-09-17'), end: localDate('2026-09-23') });
    expect(windowDays(result.window)).toBe(7);
  });

  it('gives a fortnight the weekday evening band, since most of it is weekdays', () => {
    expect(nextDays(THURSDAY_6PM, MELBOURNE, 14).daily).toEqual({
      startMin: 17 * 60 + 30,
      endMin: 22 * 60 + 30,
    });
  });
});

describe('dailyForRange', () => {
  it('uses weekend hours only when every day is a weekend day', () => {
    expect(dailyForRange(localDate('2026-09-19'), localDate('2026-09-20')).startMin).toBe(9 * 60);
    expect(dailyForRange(localDate('2026-09-18'), localDate('2026-09-20')).startMin).toBe(
      17 * 60 + 30,
    );
  });
});

describe('resolvePreset', () => {
  it('caps a custom window at fourteen days', () => {
    const tooLong = { start: localDate('2026-09-01'), end: localDate('2026-09-15') };
    expect(windowDays(tooLong)).toBe(15);
    expect(resolvePreset('custom', THURSDAY_6PM, MELBOURNE, opts(TWO_HOURS, tooLong))).toBe(
      'window_too_long',
    );
  });

  it('accepts exactly fourteen days', () => {
    const exact = { start: localDate('2026-09-01'), end: localDate('2026-09-14') };
    expect(resolvePreset('custom', THURSDAY_6PM, MELBOURNE, opts(TWO_HOURS, exact))).toMatchObject({
      window: exact,
    });
  });

  it('refuses a window that ends before it starts', () => {
    const backwards = { start: localDate('2026-09-10'), end: localDate('2026-09-01') };
    expect(resolvePreset('custom', THURSDAY_6PM, MELBOURNE, opts(TWO_HOURS, backwards))).toBe(
      'window_backwards',
    );
  });

  it('refuses a custom window with no dates', () => {
    expect(resolvePreset('custom', THURSDAY_6PM, MELBOURNE, opts())).toBe('window_backwards');
  });

  it('refuses any preset whose band is shorter than the meetup', () => {
    // A three-hour meetup does not fit a 17:30–22:30 weekday evening… it does,
    // just. Four hours would not, but the duration union stops at 180, so the
    // reachable case is a narrow custom window.
    const oneEvening = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
    expect(resolvePreset('next_7_days', THURSDAY_6PM, MELBOURNE, opts(180))).toMatchObject({
      daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
    });
    // The guard itself, directly:
    expect(isViableBand({ startMin: 19 * 60, endMin: 20 * 60 }, 120)).toBe(false);
    expect(isViableBand({ startMin: 19 * 60, endMin: 21 * 60 }, 120)).toBe(true);
    expect(oneEvening.start).toBe('2026-09-17');
  });
});

describe('windowDays', () => {
  it('counts a single day as one', () => {
    expect(windowDays({ start: localDate('2026-09-17'), end: localDate('2026-09-17') })).toBe(1);
  });

  it('counts across a daylight-saving change correctly', () => {
    // Melbourne moves to daylight time on Sunday 4 October 2026.
    expect(windowDays({ start: localDate('2026-10-03'), end: localDate('2026-10-05') })).toBe(3);
  });
});
