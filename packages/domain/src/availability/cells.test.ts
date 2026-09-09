import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { durationMinutes, type Interval } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { toLocal } from '../shared/zone.js';
import {
  VISIBLE_CELLS,
  cellAt,
  cellCount,
  cellsFor,
  cellsToWindows,
  windowsToCells,
} from './cells.js';
import { rangeText } from './format.js';
import { applyShortcut } from './shortcuts.js';

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

describe('across a daylight-saving change', () => {
  // Melbourne springs forward on 2026-10-04: 02:00 becomes 03:00, so wall-clock
  // 02:00 and 02:30 never happen. A custom band can span that.
  const SPRING = localDate('2026-10-04');
  const spring = plan({
    window: { start: SPRING, end: SPRING },
    daily: { startMin: 60, endMin: 5 * 60 },
  });

  it('reports the half hours that do not exist', () => {
    const cells = cellsFor(SPRING, spring);
    // Indices 2 and 3 are the nominal 02:00 and 02:30.
    expect(cells.map((c) => c === undefined)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps cells distinct, so painting one does not select three', () => {
    // Deriving each end by adding thirty minutes gave 02:00, 02:30 and 03:00
    // the same interval: painting 03:00 read back as all three painted.
    const painted = new Array(cellCount(spring)).fill(false);
    painted[4] = true; // the real 03:00
    const windows = cellsToWindows(SPRING, painted, spring);
    expect(windows).toHaveLength(1);
    expect(windowsToCells(SPRING, windows, spring).filter(Boolean)).toHaveLength(1);
    expect(windowsToCells(SPRING, windows, spring)[4]).toBe(true);
  });

  it('offers nothing for a half hour that did not happen', () => {
    const painted = new Array(cellCount(spring)).fill(false);
    painted[2] = true; // nominal 02:00, which never occurred
    expect(cellsToWindows(SPRING, painted, spring)).toEqual([]);
    // …and it reads back unpainted, because there is nothing to be free during.
    expect(windowsToCells(SPRING, [], spring)[2]).toBe(false);
  });

  describe('when the clocks go back', () => {
    // Melbourne repeats 02:00–03:00 on 2026-04-05, so wall-clock 02:30–03:00
    // is ninety real minutes.
    const FALL = localDate('2026-04-05');
    const fall = plan({
      window: { start: FALL, end: FALL },
      daily: { startMin: 60, endMin: 5 * 60 },
    });

    it('never renders a cell backwards', () => {
      // Capping the cell at thirty minutes ended the 02:30 cell at the second
      // 02:00, so it read "2:30–2 am".
      for (const cell of cellsFor(FALL, fall)) {
        expect(cell).toBeDefined();
        expect((cell as Interval).end).toBeGreaterThan((cell as Interval).start);
      }
      expect(rangeText([cellAt(FALL, 3, fall) as Interval], MELBOURNE)).toBe('2:30–3 am');
    });

    it('lets one cell be longer than half an hour, because the clock was', () => {
      expect(durationMinutes(cellAt(FALL, 3, fall) as Interval)).toBe(90);
      expect(durationMinutes(cellAt(FALL, 2, fall) as Interval)).toBe(30);
    });
  });

  describe('cells cover the band exactly', () => {
    // The property that catches both DST directions: painting every cell has to
    // come to the same time as the "any time" shortcut, or a boundary is wrong.
    it.each([
      ['an ordinary day', '2026-09-17'],
      ['the day the clocks go back', '2026-04-05'],
      ['the day the clocks go forward', '2026-10-04'],
    ])('%s', (_label, date) => {
      const day = localDate(date);
      const p = plan({
        window: { start: day, end: day },
        daily: { startMin: 60, endMin: 5 * 60 },
      });

      const everyCell = cellsToWindows(day, new Array(cellCount(p)).fill(true), p);
      const anyTime = applyShortcut('any_time', day, p) as Interval;

      const painted = everyCell.reduce((total, w) => total + durationMinutes(w), 0);
      expect(painted).toBe(durationMinutes(anyTime));
      // Contiguous, so `merge` collapses them to one span covering the band.
      expect(everyCell).toHaveLength(1);
      expect(everyCell[0]).toEqual(anyTime);
    });
  });

  it('round-trips on the transition day for the cells that exist', () => {
    const count = cellCount(spring);
    const painted = Array.from(
      { length: count },
      (_, i) => cellAt(SPRING, i, spring) !== undefined,
    );
    const windows = cellsToWindows(SPRING, painted, spring);
    expect(windowsToCells(SPRING, windows, spring)).toEqual(painted);
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
