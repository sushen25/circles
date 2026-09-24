import { describe, expect, it } from 'vitest';

import { lastEnd, monthDays, rangeOf, shiftMonth, tapDay } from './calendar';

/** The CustomWindow grid: two taps make a range, at most fourteen days (spec §5.3). */
describe('picking a range', () => {
  it('takes a start, then an end', () => {
    const start = tapDay({ start: undefined, end: undefined }, '2026-09-21');
    expect(start).toEqual({ start: '2026-09-21', end: undefined });
    expect(rangeOf(start)).toEqual({ start: '2026-09-21', end: '2026-09-21' });
    expect(tapDay(start, '2026-09-27')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });

  it('starts again from a day before the start, or past the fourteenth', () => {
    const start = { start: '2026-09-21', end: undefined };
    expect(tapDay(start, '2026-09-20')).toEqual({ start: '2026-09-20', end: undefined });
    expect(lastEnd(start)).toBe('2026-10-04');
    expect(tapDay(start, '2026-10-04')).toEqual({ start: '2026-09-21', end: '2026-10-04' });
    expect(tapDay(start, '2026-10-05')).toEqual({ start: '2026-10-05', end: undefined });
  });

  it('starts again after a finished range', () => {
    expect(tapDay({ start: '2026-09-21', end: '2026-09-22' }, '2026-09-25')).toEqual({
      start: '2026-09-25',
      end: undefined,
    });
  });
});

describe('the month', () => {
  it('lays September 2026 out Monday first, the 1st on a Tuesday', () => {
    const days = monthDays('2026-09-01', '2026-09-15', { start: undefined, end: undefined });
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: '2026-09-01', slot: 1 });
  });

  it('shows days gone as not pickable, and a picked range as picked', () => {
    const days = monthDays('2026-09-01', '2026-09-15', { start: '2026-09-21', end: '2026-09-23' });
    expect(days[13]).toMatchObject({ date: '2026-09-14', disabled: true, why: 'past' });
    expect(days[14]).toMatchObject({ date: '2026-09-15', disabled: false });
    expect(days.filter((d) => d.selected).map((d) => d.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);
  });

  it('marks, and still offers, the days past the cap while an end is chosen', () => {
    const days = monthDays('2026-10-01', '2026-09-15', { start: '2026-09-26', end: undefined });
    expect(days[8]).toMatchObject({ date: '2026-10-09', why: undefined });
    expect(days[9]).toMatchObject({ date: '2026-10-10', why: 'too_far', disabled: false });
  });

  it('pages across a year end', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2027-01-01', -1)).toBe('2026-12-01');
  });
});
