import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { durationMinutes, type Interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { toLocal } from '../shared/zone.js';
import { VISIBLE_CELLS, cellCount, cellsToWindows, windowsToCells } from './cells.js';

const DAY = localDate('2026-09-17');

describe('cellCount', () => {
  it('is ten for the weekday evening band — the spec example', () => {
    expect(cellCount(plan())).toBe(VISIBLE_CELLS);
  });

  it('is twenty-seven for a weekend day, which is why the row scrolls', () => {
    // 09:00–22:30 is 13.5 hours. Stretching a cell to fit ten across would
    // make each 81 minutes, so the ticket chose fixed 30-minute cells instead.
    const weekend = plan({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });
    expect(cellCount(weekend)).toBe(27);
  });
});

describe('cellsToWindows', () => {
  const p = plan();

  it('turns one painted cell into one half-hour window', () => {
    const cells = Array.from({ length: cellCount(p) }, (_, i) => i === 0);
    const [only] = cellsToWindows(DAY, cells, p);
    expect(durationMinutes(only as Interval)).toBe(30);
    expect(toLocal((only as Interval).start, MELBOURNE).minutesOfDay).toBe(17 * 60 + 30);
  });

  it('merges adjacent cells, so four in a row is one two-hour window', () => {
    const cells = Array.from({ length: cellCount(p) }, (_, i) => i < 4);
    const windows = cellsToWindows(DAY, cells, p);
    expect(windows).toHaveLength(1);
    expect(durationMinutes(windows[0] as Interval)).toBe(120);
  });

  it('keeps a gap as a gap', () => {
    const cells = Array.from({ length: cellCount(p) }, (_, i) => i === 0 || i === 5);
    expect(cellsToWindows(DAY, cells, p)).toHaveLength(2);
  });

  it('is empty when nothing is painted', () => {
    expect(cellsToWindows(DAY, new Array(cellCount(p)).fill(false), p)).toEqual([]);
  });

  it('ignores cells beyond the day, rather than inventing time after it', () => {
    const tooMany = new Array(cellCount(p) + 5).fill(true);
    const windows = cellsToWindows(DAY, tooMany, p);
    expect(windows).toHaveLength(1);
    expect(toLocal((windows[0] as Interval).end, MELBOURNE).minutesOfDay).toBe(22 * 60 + 30);
  });
});

describe('windowsToCells', () => {
  const p = plan();

  it('paints only cells the window covers completely', () => {
    // A window over cells 0 and 1 exactly.
    const windows = cellsToWindows(
      DAY,
      Array.from({ length: cellCount(p) }, (_, i) => i < 2),
      p,
    );
    const cells = windowsToCells(DAY, windows, p);
    expect(cells.slice(0, 3)).toEqual([true, true, false]);
  });

  it('leaves a partially covered cell unpainted — painting it would round outward', () => {
    // 17:45–18:15 covers half of cell 0 and half of cell 1, and neither fully.
    const partial = cellsToWindows(DAY, [true], p);
    const shifted = [
      {
        start: ((partial[0] as Interval).start + 15 * 60_000) as Interval['start'],
        end: ((partial[0] as Interval).end + 15 * 60_000) as Interval['end'],
      } as Interval,
    ];
    expect(windowsToCells(DAY, shifted, p).every((c) => c === false)).toBe(true);
  });

  it('is all false for a day with nothing painted', () => {
    expect(windowsToCells(DAY, [], p)).toEqual(new Array(cellCount(p)).fill(false));
  });
});

describe('round trip', () => {
  const p = plan();

  it('cells → windows → cells returns what was painted', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }), (cells) => {
        const windows = cellsToWindows(DAY, cells, p);
        expect(windowsToCells(DAY, windows, p)).toEqual(cells);
      }),
    );
  });

  it('round-trips on a long weekend day too', () => {
    const weekend = plan({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });
    const count = cellCount(weekend);
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: count, maxLength: count }), (cells) => {
        const windows = cellsToWindows(DAY, cells, weekend);
        expect(windowsToCells(DAY, windows, weekend)).toEqual(cells);
      }),
    );
  });
});
