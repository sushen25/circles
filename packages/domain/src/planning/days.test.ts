import { describe, expect, it } from 'vitest';

import { localDate, type LocalDate } from '../shared/local-date.js';
import {
  askedDayCount,
  askedDays,
  asksAbout,
  dayRuns,
  daysChange,
  hasGaps,
  sameDays,
  widestFrom,
  windowError,
  windowFromDays,
} from './days.js';
import type { DateWindow } from './types.js';

const d = (value: string): LocalDate => localDate(value);
const days = (...values: string[]): LocalDate[] => values.map(d);

/** Thu 17 – Sun 20 Sep, Tue 22 Sep, Thu 24 – Sun 27 Sep: the ticket's own example. */
const GAPPY: DateWindow = {
  start: d('2026-09-17'),
  end: d('2026-09-27'),
  days: days(
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
    '2026-09-22',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
  ),
};

describe('a window with no days listed', () => {
  const fortnight = { start: d('2026-09-14'), end: d('2026-09-27') };

  it('asks about every day from the first to the last, as every plan always has', () => {
    expect(askedDays(fortnight)).toHaveLength(14);
    expect(askedDayCount(fortnight)).toBe(14);
    expect(hasGaps(fortnight)).toBe(false);
    expect(asksAbout(fortnight, d('2026-09-16'))).toBe(true);
    expect(asksAbout(fortnight, d('2026-09-28'))).toBe(false);
  });
});

describe('a window with gaps', () => {
  it('asks about its days and no others', () => {
    expect(askedDays(GAPPY)).toEqual(GAPPY.days);
    expect(askedDayCount(GAPPY)).toBe(9);
    expect(hasGaps(GAPPY)).toBe(true);
    expect(asksAbout(GAPPY, d('2026-09-22'))).toBe(true);
    expect(asksAbout(GAPPY, d('2026-09-21'))).toBe(false);
    expect(asksAbout(GAPPY, d('2026-09-23'))).toBe(false);
  });

  it('says itself as runs', () => {
    expect(dayRuns(GAPPY)).toEqual([
      { start: d('2026-09-17'), end: d('2026-09-20') },
      { start: d('2026-09-22'), end: d('2026-09-22') },
      { start: d('2026-09-24'), end: d('2026-09-27') },
    ]);
  });
});

describe('windowFromDays', () => {
  it('sorts and de-duplicates, and lists the days only when there is a gap', () => {
    expect(windowFromDays(days('2026-09-19', '2026-09-17', '2026-09-18', '2026-09-17'))).toEqual({
      start: d('2026-09-17'),
      end: d('2026-09-19'),
    });
    expect(windowFromDays(days('2026-09-22', '2026-09-17'))).toEqual({
      start: d('2026-09-17'),
      end: d('2026-09-22'),
      days: days('2026-09-17', '2026-09-22'),
    });
  });

  it('is one day for one day, and nothing for nothing', () => {
    expect(windowFromDays(days('2026-09-17'))).toEqual({
      start: d('2026-09-17'),
      end: d('2026-09-17'),
    });
    expect(windowFromDays([])).toBeUndefined();
  });
});

describe('windowError', () => {
  it('accepts a well formed window with gaps', () => {
    expect(windowError(GAPPY)).toBeUndefined();
  });

  it('refuses days out of order, repeated, or not ending on the ends', () => {
    const base = { start: d('2026-09-17'), end: d('2026-09-22') };
    expect(windowError({ ...base, days: days('2026-09-22', '2026-09-17') })).toBe('days_invalid');
    expect(windowError({ ...base, days: days('2026-09-17', '2026-09-17', '2026-09-22') })).toBe(
      'days_invalid',
    );
    expect(windowError({ ...base, days: days('2026-09-18', '2026-09-22') })).toBe('days_invalid');
    expect(windowError({ ...base, days: days('2026-09-17', '2026-09-23') })).toBe('days_invalid');
    expect(windowError({ ...base, days: [] })).toBe('days_invalid');
  });

  it('keeps the thirty-day cap as a span from first to last (ADR 0030)', () => {
    const start = d('2026-09-01');
    expect(
      windowError({ start, end: d('2026-09-30'), days: days('2026-09-01', '2026-09-30') }),
    ).toBe(undefined);
    expect(
      windowError({ start, end: d('2026-10-01'), days: days('2026-09-01', '2026-10-01') }),
    ).toBe('window_too_long');
  });
});

describe('daysChange: what changing the days costs (ADR 0047)', () => {
  const week = { start: d('2026-09-14'), end: d('2026-09-20') };

  it('is free to take away days nobody picked', () => {
    const fewer = windowFromDays(
      days('2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'),
    )!;
    expect(daysChange(week, fewer, days('2026-09-17'))).toBe('narrow');
  });

  it('is free to take away the first or last day when nobody picked it', () => {
    const shorter = { start: d('2026-09-14'), end: d('2026-09-19') };
    expect(daysChange(week, shorter, days('2026-09-17'))).toBe('narrow');
  });

  it('asks again when a day somebody picked goes', () => {
    const fewer = windowFromDays(days('2026-09-14', '2026-09-15', '2026-09-20'))!;
    expect(daysChange(week, fewer, days('2026-09-17'))).toBe('reask');
  });

  it('asks again when a day is added, even if another goes for free', () => {
    const moved = { start: d('2026-09-15'), end: d('2026-09-21') };
    expect(daysChange(week, moved, [])).toBe('reask');
  });

  it('says nothing changed when the same days are written another way', () => {
    const listed = { ...week, days: askedDays(week) };
    expect(daysChange(week, listed, [])).toBe('same');
    expect(sameDays(week, listed)).toBe(true);
  });
});

describe('widestFrom', () => {
  it('runs thirty days from the first and drops the gaps', () => {
    expect(widestFrom(GAPPY)).toEqual({ start: d('2026-09-17'), end: d('2026-10-16') });
  });
});
