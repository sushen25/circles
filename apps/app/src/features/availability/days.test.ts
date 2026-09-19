import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows, type RowWords } from './days';

const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => `${label}, after the clocks go back`,
  crossing: (label) => `${label}, as the clocks go back`,
  clocksGoBack: 'Clocks go back',
};
const TWELVE = { hour12: true };

function timing(overrides: Partial<PlanTiming> = {}): PlanTiming {
  return {
    window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
    daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
    durationMinutes: 120,
    zone: zone('Australia/Melbourne'),
    ...overrides,
  };
}

describe('dayRows', () => {
  it('gives a fortnight of evenings ten half hours a day, each named by date and time', () => {
    const rows = dayRows(timing(), TWELVE, WORDS, 'en-AU');

    expect(rows).toHaveLength(14);
    // Whatever the runtime's ICU spells September as, short: "Sep" or "Sept".
    expect(rows[0]!.short).toMatch(/^Mon 14 Sept?$/);
    expect(rows[0]!.cells).toHaveLength(10);
    expect(rows[0]!.cellLabels[0]).toBe('Monday 14 September, 5:30 to 6 pm');
    expect(rows[0]!.cellLabels[9]).toBe('Monday 14 September, 10 to 10:30 pm');
    // The canvas's start, middle and end.
    expect(rows[0]!.marks.map((m) => m.label)).toEqual(['5:30 pm', '8 pm', '10:30 pm']);
  });

  it('marks a scrolling weekend day every two hours, so the middle of it can be found', () => {
    const [saturday] = dayRows(
      timing({
        window: { start: localDate('2026-09-19'), end: localDate('2026-09-19') },
        daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
      }),
      TWELVE,
      WORDS,
      'en-AU',
    );

    expect(saturday!.cells).toHaveLength(27);
    expect(saturday!.marks.map((m) => m.at)).toEqual([0, 4, 8, 12, 16, 20, 24, 27]);
    expect(saturday!.marks.at(-1)!.label).toBe('10:30 pm');
  });

  it('names the second 2 am the night the clocks go back, rather than two identical cells', () => {
    // Melbourne leaves daylight saving on the first Sunday of April.
    const [night] = dayRows(
      timing({
        window: { start: localDate('2027-04-04'), end: localDate('2027-04-04') },
        daily: { startMin: 60, endMin: 5 * 60 },
      }),
      TWELVE,
      WORDS,
      'en-AU',
    );

    // Four hours on the clock, five hours of real time.
    expect(night!.cells).toHaveLength(10);
    const repeated = night!.cellLabels.filter((label) =>
      label.endsWith('after the clocks go back'),
    );
    expect(repeated.length).toBeGreaterThanOrEqual(2);
    expect(new Set(night!.cellLabels).size).toBe(night!.cellLabels.length);
    expect(night!.marks.map((m) => m.label)).toContain('Clocks go back');
    // The half hour the clocks go back in reads "2:30 to 2 am", which is true
    // and, unexplained, looks like a typo (round 2).
    expect(night!.cellLabels).toContain('Sunday 4 April, 2:30 to 2 am, as the clocks go back');
  });

  it('leaves out a day whose band does not happen at all (the clocks go forward through it)', () => {
    const rows = dayRows(
      timing({
        window: { start: localDate('2026-10-03'), end: localDate('2026-10-05') },
        daily: { startMin: 2 * 60, endMin: 3 * 60 },
      }),
      TWELVE,
      WORDS,
      'en-AU',
    );

    expect(rows.map((row) => row.date)).toEqual(['2026-10-03', '2026-10-05']);
  });

  it('reads a band that runs to midnight as ending at 12 am, not 0:00', () => {
    const [row] = dayRows(
      timing({
        window: { start: localDate('2026-09-14'), end: localDate('2026-09-14') },
        daily: { startMin: 22 * 60, endMin: 24 * 60 },
      }),
      TWELVE,
      WORDS,
      'en-AU',
    );

    expect(row!.cellLabels.at(-1)).toBe('Monday 14 September, 11:30 pm to 12 am');
  });

  it('uses a 24-hour clock when the device does', () => {
    const [row] = dayRows(timing(), { hour12: false }, WORDS, 'en-GB');

    expect(row!.cellLabels[0]).toBe('Monday 14 September, 17:30 to 18:00');
  });
});
