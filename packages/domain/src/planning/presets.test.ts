import { describe, expect, it } from 'vitest';

import { fromISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import type { DateWindow } from './types.js';
import { toLocal, zone } from '../shared/zone.js';
import { MELBOURNE } from '../shared/fixtures.js';
import type { DurationMinutes } from './types.js';
import {
  dailyForRange,
  hasFutureStart,
  isViableBand,
  validateBand,
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

  it('refuses a meetup that fits exactly, because it could only start in the past', () => {
    // 22:30 leaves exactly 60 minutes, so an hour *fits* — and its last
    // possible start is 22:30, this instant, which is not a future start. The
    // reason is the clock, not the deadline: tonight's default deadline gives
    // up its margin rather than the plan (see `defaultDeadline`), so a plan
    // with fifteen minutes of reply time is offered and this one is not.
    const halfTen = fromISO('2026-09-17T12:30:00Z');
    expect(tonight(halfTen, MELBOURNE, 60)).toBeUndefined();
    expect(tonight(halfTen, MELBOURNE, 90)).toBeUndefined();
  });

  it('judges a chosen band, not the default one', () => {
    // 20:45 with a three-hour meetup. The default band ends 23:30, which is
    // fifteen minutes short — but an organiser who asked for one running to
    // midnight has room, and refusing them would be enforcing a default.
    const quarterToNine = fromISO('2026-09-17T10:45:00Z');
    expect(toLocal(quarterToNine, MELBOURNE).minutesOfDay).toBe(20 * 60 + 45);
    expect(tonight(quarterToNine, MELBOURNE, 180)).toBeUndefined();

    const toMidnight = { startMin: 21 * 60, endMin: 24 * 60 };
    expect(tonight(quarterToNine, MELBOURNE, 180, toMidnight)?.daily).toEqual(toMidnight);
    expect(
      resolvePreset('tonight', quarterToNine, MELBOURNE, {
        durationMinutes: 180 as DurationMinutes,
        daily: toMidnight,
      }),
    ).toEqual({
      window: { start: localDate('2026-09-17'), end: localDate('2026-09-17') },
      daily: toMidnight,
    });
  });

  it('will not let a chosen band start tonight in the past', () => {
    // "Tonight from 6 pm" asked at half past eight is tonight from 8:30.
    const halfEight = fromISO('2026-09-17T10:30:00Z');
    expect(
      tonight(halfEight, MELBOURNE, TWO_HOURS, { startMin: 18 * 60, endMin: 24 * 60 })?.daily,
    ).toEqual({ startMin: 20 * 60 + 30, endMin: 24 * 60 });
  });

  it('says what is wrong with a malformed band rather than blaming the hour', () => {
    // Half past six, hours of evening left: `band_unaligned` is the honest
    // answer, and `too_late_for_tonight` would send the organiser to fix the
    // wrong thing.
    expect(
      resolvePreset('tonight', THURSDAY_6PM, MELBOURNE, {
        durationMinutes: TWO_HOURS,
        daily: { startMin: 19 * 60 + 7, endMin: 23 * 60 },
      }),
    ).toBe('band_unaligned');
  });

  it('still offers a short meetup while there is genuinely room', () => {
    // 21:30 leaves two hours: an hour-long meetup has a last possible start of
    // 22:30, an hour away, so there is time to answer.
    const halfNine = fromISO('2026-09-17T11:30:00Z');
    expect(tonight(halfNine, MELBOURNE, 60)?.daily).toEqual({
      startMin: 21 * 60 + 30,
      endMin: 23 * 60 + 30,
    });
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
    const tooLong = { start: localDate('2026-09-18'), end: localDate('2026-10-02') };
    expect(windowDays(tooLong)).toBe(15);
    expect(resolvePreset('custom', THURSDAY_6PM, MELBOURNE, opts(TWO_HOURS, tooLong))).toBe(
      'window_too_long',
    );
  });

  it('accepts exactly fourteen days', () => {
    // In the future: a fortnight that ended last week is refused for a better
    // reason than its length, and this test is about the length.
    const exact = { start: localDate('2026-09-18'), end: localDate('2026-10-01') };
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

  it('refuses a window whose last possible start has already passed', () => {
    // A 17:30–22:30 evening comfortably fits two hours, so the band check is
    // happy. But if today is the only day and it is already 22:00, the last
    // possible start was ninety minutes ago.
    const tenPm = fromISO('2026-09-17T12:00:00Z');
    const today = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
    expect(isViableBand({ startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 }, 120)).toBe(true);
    expect(resolvePreset('custom', tenPm, MELBOURNE, opts(TWO_HOURS, today))).toBe(
      'window_has_passed',
    );
  });

  it('still offers a custom window with only minutes left, which the spec permits', () => {
    // Twenty-nine minutes before the last possible start. Tight, not invalid:
    // the organiser may set the deadline anywhere up to that point.
    const at2001 = fromISO('2026-09-17T10:01:00Z');
    const today = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
    expect(resolvePreset('custom', at2001, MELBOURNE, opts(TWO_HOURS, today))).toMatchObject({
      window: today,
    });
  });

  it('accepts the same window earlier in the day', () => {
    const sixPm = fromISO('2026-09-17T08:00:00Z');
    const today = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
    expect(resolvePreset('custom', sixPm, MELBOURNE, opts(TWO_HOURS, today))).toMatchObject({
      window: today,
    });
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

describe('hasFutureStart', () => {
  const today = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
  const evening = { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 };
  // Last possible start for a two-hour meetup in this band is 20:30.

  it('permits a tight window, because the spec does', () => {
    // "Editable, never after the last possible start" (§5.3) sets an upper
    // bound and no lower one. A plan with a minute left is tight, not invalid,
    // and imposing a minimum here would be inventing a product rule.
    expect(hasFutureStart(fromISO('2026-09-17T10:01:00Z'), today, evening, 120, MELBOURNE)).toBe(
      true,
    );
    expect(hasFutureStart(fromISO('2026-09-17T10:29:00Z'), today, evening, 120, MELBOURNE)).toBe(
      true,
    );
  });

  it('refuses only once the last possible start has actually passed', () => {
    expect(hasFutureStart(fromISO('2026-09-17T10:30:00Z'), today, evening, 120, MELBOURNE)).toBe(
      false,
    );
    expect(hasFutureStart(fromISO('2026-09-17T12:00:00Z'), today, evening, 120, MELBOURNE)).toBe(
      false,
    );
  });
});

describe('a chosen daily band', () => {
  const today = { start: localDate('2026-09-18'), end: localDate('2026-09-20') };
  const soon = fromISO('2026-09-17T02:00:00Z');

  it('replaces the preset default, so any time of day can be asked about', () => {
    // The presets suggest evenings for a mixed range. Spec §5.3 offers "custom"
    // as a time-of-day option, and without this the suggestion was a cap: a plan
    // could not ask about a Sunday afternoon, which the Candidates artboard shows.
    const result = resolvePreset('custom', soon, MELBOURNE, {
      durationMinutes: TWO_HOURS,
      custom: today,
      daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
    });
    expect(result).toMatchObject({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });
  });

  it('leaves the defaults alone when nothing is chosen', () => {
    expect(resolvePreset('next_7_days', soon, MELBOURNE, opts())).toMatchObject({
      daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
    });
  });

  it('refuses a band that runs backwards or escapes the day', () => {
    expect(validateBand({ startMin: 14 * 60, endMin: 12 * 60 })).toBe('band_backwards');
    expect(validateBand({ startMin: 22 * 60, endMin: 25 * 60 })).toBe('band_out_of_day');
    expect(validateBand({ startMin: -30, endMin: 60 })).toBe('band_out_of_day');
  });

  it('allows a band ending at midnight', () => {
    // 24:00 is not a time of day, so `fromLocal` refuses it — but as the *end*
    // of a band it is the obvious way to say "until midnight", and a band that
    // could stop at 23:30 but not midnight would be a strange thing to explain.
    expect(validateBand({ startMin: 21 * 60, endMin: 24 * 60 })).toBeUndefined();
    expect(validateBand({ startMin: 21 * 60, endMin: 24 * 60 + 30 })).toBe('band_out_of_day');
  });

  it('requires half hours, because everything else works in them', () => {
    // Not a limit on which hours: a band edge at 17:45 would put the first cell
    // at 18:00 and quietly lose the quarter hour.
    expect(validateBand({ startMin: 17 * 60 + 45, endMin: 22 * 60 })).toBe('band_unaligned');
    expect(validateBand({ startMin: 17 * 60 + 30, endMin: 22 * 60 })).toBeUndefined();
  });

  it('is still judged on viability once chosen', () => {
    expect(
      resolvePreset('custom', soon, MELBOURNE, {
        durationMinutes: 180,
        custom: today,
        daily: { startMin: 12 * 60, endMin: 13 * 60 },
      }),
    ).toBe('band_shorter_than_meetup');
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
