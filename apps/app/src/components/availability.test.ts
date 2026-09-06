import { describe, expect, it } from 'vitest';

import { cellLabel, paintSpan, rangeLabel, toRanges } from './availability';

const NONE = new Array(10).fill(false) as boolean[];
/** Cells start at 5:30 pm on the canvas. */
const START = 17 * 60 + 30;
const at = (minutes: number) =>
  `${Math.floor(minutes / 60) % 24}:${String(minutes % 60).padStart(2, '0')}`;

describe('painting', () => {
  it('paints a single cell', () => {
    expect(paintSpan(NONE, 3, 3, true)[3]).toBe(true);
  });

  it('paints a span in either direction', () => {
    const forwards = paintSpan(NONE, 2, 5, true);
    const backwards = paintSpan(NONE, 5, 2, true);
    expect(forwards).toEqual(backwards);
    expect(forwards.filter(Boolean)).toHaveLength(4);
  });

  it('clamps a span to the track rather than growing it', () => {
    const painted = paintSpan(NONE, -3, 20, true);
    expect(painted).toHaveLength(NONE.length);
    expect(painted.every(Boolean)).toBe(true);
  });

  it('erases when the stroke starts on a selected cell', () => {
    const all = new Array(10).fill(true) as boolean[];
    expect(paintSpan(all, 0, 4, false).filter(Boolean)).toHaveLength(5);
  });

  it('does not mutate the cells it was given', () => {
    const before = [...NONE];
    paintSpan(NONE, 0, 9, true);
    expect(NONE).toEqual(before);
  });
});

describe('normalising to ranges', () => {
  it('finds nothing in an empty day', () => {
    expect(toRanges(NONE)).toEqual([]);
  });

  it('merges contiguous cells into one range', () => {
    expect(toRanges(paintSpan(NONE, 2, 5, true))).toEqual([{ from: 2, to: 6 }]);
  });

  it('keeps disjoint runs apart', () => {
    const cells = paintSpan(paintSpan(NONE, 0, 1, true), 5, 6, true);
    expect(toRanges(cells)).toEqual([
      { from: 0, to: 2 },
      { from: 5, to: 7 },
    ]);
  });

  it('closes a range that runs to the end of the day', () => {
    expect(toRanges(paintSpan(NONE, 8, 9, true))).toEqual([{ from: 8, to: 10 }]);
  });
});

describe('the range in words', () => {
  it('says so plainly when nothing is picked — never just an empty row', () => {
    expect(rangeLabel(NONE, START, at)).toBe('Not this day');
  });

  it('reads from the start of the first cell to the end of the last', () => {
    // cells 2..9 selected → 6:30 pm to 10:30 pm, as on the canvas
    expect(rangeLabel(paintSpan(NONE, 2, 9, true), START, at)).toBe('18:30–22:30');
  });

  it('lists disjoint runs', () => {
    const cells = paintSpan(paintSpan(NONE, 0, 0, true), 4, 4, true);
    expect(rangeLabel(cells, START, at)).toBe('17:30–18:00, 19:30–20:00');
  });

  it('drops a shared day period from the opening time', () => {
    const twelveHour = (m: number) => {
      const h = Math.floor(m / 60) % 24;
      const suffix = h >= 12 ? 'pm' : 'am';
      const hour = h % 12 === 0 ? 12 : h % 12;
      return m % 60 === 0
        ? `${hour} ${suffix}`
        : `${hour}:${String(m % 60).padStart(2, '0')} ${suffix}`;
    };
    expect(rangeLabel(paintSpan(NONE, 2, 9, true), START, twelveHour)).toBe('6:30–10:30 pm');
  });
});

describe('what a screen reader hears', () => {
  it('names the day and the half hour, not the cell number', () => {
    expect(cellLabel('Thursday 17 September', 2, START, at)).toBe(
      'Thursday 17 September, 18:30 to 19:00',
    );
  });
});
