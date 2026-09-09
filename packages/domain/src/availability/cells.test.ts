import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { plan } from '../planning/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { durationMinutes, type Interval, interval } from '../shared/interval.js';
import { addMinutes, fromISO } from '../shared/instant.js';
import { isOk } from '../shared/result.js';
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
import { normaliseWindows } from './windows.js';
import { rangeText } from './format.js';
import { applyShortcut } from './shortcuts.js';

const DAY = localDate('2026-09-17');

describe('cellCount', () => {
  it('is ten for the weekday evening band — the spec example', () => {
    expect(cellCount(DAY, plan())).toBe(VISIBLE_CELLS);
  });

  it('is twenty-seven for a weekend day, which is why the row scrolls', () => {
    // 09:00–22:30 is 13.5 hours. Stretching a cell to fit ten across would
    // make each 81 minutes, so the ticket chose fixed 30-minute cells instead.
    const weekend = plan({ daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } });
    expect(cellCount(DAY, weekend)).toBe(27);
  });
});

describe('cellsToWindows', () => {
  const p = plan();

  it('turns one painted cell into one half-hour window', () => {
    const cells = Array.from({ length: cellCount(DAY, p) }, (_, i) => i === 0);
    const [only] = cellsToWindows(DAY, cells, p);
    expect(durationMinutes(only as Interval)).toBe(30);
    expect(toLocal((only as Interval).start, MELBOURNE).minutesOfDay).toBe(17 * 60 + 30);
  });

  it('merges adjacent cells, so four in a row is one two-hour window', () => {
    const cells = Array.from({ length: cellCount(DAY, p) }, (_, i) => i < 4);
    const windows = cellsToWindows(DAY, cells, p);
    expect(windows).toHaveLength(1);
    expect(durationMinutes(windows[0] as Interval)).toBe(120);
  });

  it('keeps a gap as a gap', () => {
    const cells = Array.from({ length: cellCount(DAY, p) }, (_, i) => i === 0 || i === 5);
    expect(cellsToWindows(DAY, cells, p)).toHaveLength(2);
  });

  it('is empty when nothing is painted', () => {
    expect(cellsToWindows(DAY, new Array(cellCount(DAY, p)).fill(false), p)).toEqual([]);
  });

  it('ignores cells beyond the day, rather than inventing time after it', () => {
    const tooMany = new Array(cellCount(DAY, p) + 5).fill(true);
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
      Array.from({ length: cellCount(DAY, p) }, (_, i) => i < 2),
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
    expect(windowsToCells(DAY, [], p)).toEqual(new Array(cellCount(DAY, p)).fill(false));
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

  it('has no cell for a half hour that never happened', () => {
    // The band is four nominal hours; two of its half hours do not occur, so
    // the day has six cells rather than eight. Cells are enumerated from the
    // band, so a missing half hour is simply not there — there is no hole to
    // represent, and nothing for a person to paint by mistake.
    const cells = cellsFor(SPRING, spring);
    expect(cells).toHaveLength(6);
    expect(rangeText(cells.slice(0, 3), MELBOURNE)).toBe('1–1:30 am, 1:30–3 am, 3–3:30 am');
  });

  it('keeps cells distinct, so painting one does not select three', () => {
    // Deriving each end by adding thirty minutes once gave 02:00, 02:30 and
    // 03:00 the same interval: painting one read back as three painted.
    const painted = new Array(cellCount(SPRING, spring)).fill(false);
    painted[2] = true; // 03:00, the first cell after the gap
    const windows = cellsToWindows(SPRING, painted, spring);
    expect(windows).toHaveLength(1);
    expect(windowsToCells(SPRING, windows, spring).filter(Boolean)).toHaveLength(1);
    expect(windowsToCells(SPRING, windows, spring)[2]).toBe(true);
  });

  describe('when the clocks go back', () => {
    // Melbourne repeats 02:00–03:00 on 2026-04-05, so wall-clock 02:30–03:00
    // is ninety real minutes.
    const FALL = localDate('2026-04-05');
    const fall = plan({
      window: { start: FALL, end: FALL },
      daily: { startMin: 60, endMin: 5 * 60 },
    });

    it('labels the transition cell by the clock, even though it reads oddly', () => {
      // Cell 3 runs from the first 02:30 to the second 02:00 — a real half hour
      // whose end genuinely reads "2 am", because that is what the clock did.
      // The row therefore shows "2–2:30 am" twice and one "2:30–2 am".
      //
      // That is truthful and confusing, and the confusion is presentation:
      // S1-25 has to disambiguate the repeated labels. What the domain owes is
      // that every cell is real, forward in time, and distinct — not that the
      // wall clock behaved sensibly.
      expect(rangeText([cellAt(FALL, 3, fall) as Interval], MELBOURNE)).toBe('2:30–2 am');
      for (const cell of cellsFor(FALL, fall)) {
        expect(cell.end).toBeGreaterThan(cell.start);
      }
    });

    it('gives each occurrence of the repeated hour its own cell', () => {
      // Ten cells, not eight: 02:00 and 02:30 happen twice, and both are real
      // time somebody can be free during. Every cell is a real half hour.
      const cells = cellsFor(FALL, fall);
      expect(cells).toHaveLength(10);
      for (const cell of cells) expect(durationMinutes(cell)).toBe(30);
    });

    it('reopens a window on the second occurrence instead of discarding it', () => {
      // With one cell per nominal local time, a window on the second 02:00
      // matched no cell, so reopening a saved response showed nothing painted
      // and quietly threw the answer away.
      const secondTwo = fromISO('2026-04-04T16:00:00Z');
      const submitted = interval(secondTwo, addMinutes(secondTwo, 30));

      const normalised = normaliseWindows([submitted], fall);
      expect(isOk(normalised)).toBe(true);
      if (!isOk(normalised)) return;

      const painted = windowsToCells(FALL, normalised.value, fall);
      expect(painted.filter(Boolean)).toHaveLength(1);
      expect(painted[4]).toBe(true); // the second 02:00
      // …and painting it again gives back exactly what was submitted.
      expect(cellsToWindows(FALL, painted, fall)).toEqual(normalised.value);
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

      const everyCell = cellsToWindows(day, new Array(cellCount(day, p)).fill(true), p);
      const anyTime = applyShortcut('any_time', day, p) as Interval;

      const painted = everyCell.reduce((total, w) => total + durationMinutes(w), 0);
      expect(painted).toBe(durationMinutes(anyTime));
      // Contiguous, so `merge` collapses them to one span covering the band.
      expect(everyCell).toHaveLength(1);
      expect(everyCell[0]).toEqual(anyTime);
    });
  });

  it('round-trips on the transition day for the cells that exist', () => {
    const count = cellCount(SPRING, spring);
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
    const count = cellCount(DAY, weekend);
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: count, maxLength: count }), (cells) => {
        const windows = cellsToWindows(DAY, cells, weekend);
        expect(windowsToCells(DAY, windows, weekend)).toEqual(cells);
      }),
    );
  });
});
