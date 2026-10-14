import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows } from './days';

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
  it('gives a fortnight of evenings ten half hours a day, each named by date', () => {
    const rows = dayRows(timing(), 'en-AU');

    expect(rows).toHaveLength(14);
    // Whatever the runtime's ICU spells September as, short: "Sep" or "Sept".
    expect(rows[0]!.short).toMatch(/^Mon 14 Sept?$/);
    expect(rows[0]!.spoken).toBe('Monday 14 September');
    expect(rows[0]!.cells).toHaveLength(10);
  });

  it('gives a weekend day the whole band: twenty-seven half hours from 9 am to 10:30 pm', () => {
    const [saturday] = dayRows(
      timing({
        window: { start: localDate('2026-09-19'), end: localDate('2026-09-19') },
        daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
      }),
      'en-AU',
    );

    expect(saturday!.cells).toHaveLength(27);
  });

  it('gives the night the clocks go back its extra cells, one for each real half hour', () => {
    // Melbourne leaves daylight saving on the first Sunday of April.
    const [night] = dayRows(
      timing({
        window: { start: localDate('2027-04-04'), end: localDate('2027-04-04') },
        daily: { startMin: 60, endMin: 5 * 60 },
      }),
      'en-AU',
    );

    // One to five o'clock is four hours on the clock and five of them in fact.
    expect(night!.cells).toHaveLength(10);
  });

  it('leaves out a day whose band does not happen at all (the clocks go forward through it)', () => {
    const rows = dayRows(
      timing({
        window: { start: localDate('2026-10-04'), end: localDate('2026-10-04') },
        daily: { startMin: 2 * 60, endMin: 3 * 60 },
      }),
      'en-AU',
    );

    expect(rows).toEqual([]);
  });
});
