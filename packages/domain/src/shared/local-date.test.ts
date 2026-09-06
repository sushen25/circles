import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, fromParts, isWeekend, localDate, weekday } from './local-date';

describe('localDate', () => {
  it('accepts a real date', () => {
    expect(localDate('2026-09-17')).toBe('2026-09-17');
    expect(localDate('2028-02-29')).toBe('2028-02-29');
  });

  it('rejects a date that does not exist, rather than rolling it forward', () => {
    expect(() => localDate('2026-02-31')).toThrow(/Not a real date/);
    expect(() => localDate('2026-13-01')).toThrow();
    expect(() => localDate('2026-02-29')).toThrow(/Not a real date/);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => localDate('17/09/2026')).toThrow(/Not a local date/);
    expect(() => localDate('2026-9-17')).toThrow();
  });

  it('pads when built from parts', () => {
    expect(fromParts(2026, 9, 7)).toBe('2026-09-07');
  });
});

describe('weekday', () => {
  it('counts Monday as 1 and Sunday as 7', () => {
    expect(weekday(localDate('2026-09-14'))).toBe(1);
    expect(weekday(localDate('2026-09-17'))).toBe(4);
    expect(weekday(localDate('2026-09-20'))).toBe(7);
  });

  it('calls Saturday and Sunday the weekend', () => {
    expect(isWeekend(localDate('2026-09-18'))).toBe(false);
    expect(isWeekend(localDate('2026-09-19'))).toBe(true);
    expect(isWeekend(localDate('2026-09-20'))).toBe(true);
  });
});

describe('arithmetic', () => {
  it('adds days across a month and a year', () => {
    expect(addDays(localDate('2026-09-30'), 1)).toBe('2026-10-01');
    expect(addDays(localDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(localDate('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('is unaffected by daylight saving — these are dates, not moments', () => {
    // Melbourne's clocks move on 4 October; the calendar does not care.
    expect(addDays(localDate('2026-10-03'), 1)).toBe('2026-10-04');
    expect(daysBetween(localDate('2026-10-03'), localDate('2026-10-05'))).toBe(2);
  });

  it('counts backwards too', () => {
    expect(daysBetween(localDate('2026-09-20'), localDate('2026-09-17'))).toBe(-3);
  });
});
