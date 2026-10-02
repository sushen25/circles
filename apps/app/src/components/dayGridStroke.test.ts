import { describe, expect, it } from 'vitest';

import { type DayBox, dayAt, dayShowingAt } from './dayGridStroke';

/** Two weeks of a month whose 1st is a Tuesday: 44pt days, 5pt apart, 65pt rows. */
function month(): (DayBox | undefined)[] {
  const boxes: (DayBox | undefined)[] = [];
  for (let day = 0; day < 13; day += 1) {
    const slot = day + 1;
    boxes.push({ x: (slot % 7) * 49, y: Math.floor(slot / 7) * 65, width: 44, height: 60 });
  }
  return boxes;
}

describe('dayAt: which day a stroke is over (ADR 0047)', () => {
  it('finds the day under the finger, across rows', () => {
    // Monday the 31st of the month before is a blank: the nearest day is the 1st.
    expect(dayAt({ x: 10, y: 10 }, month())).toBe(0);
    expect(dayAt({ x: 60, y: 10 }, month())).toBe(0);
    // The second row starts on the Monday, the 7th: index 6.
    expect(dayAt({ x: 10, y: 80 }, month())).toBe(6);
    expect(dayAt({ x: 300, y: 80 }, month())).toBe(12);
  });

  it('takes the nearest day in the row when the finger is in a gap', () => {
    // 46 is in the gap between the first column (0–44) and the second (49–93).
    expect(dayAt({ x: 46, y: 80 }, month())).toBe(6);
    expect(dayAt({ x: 48, y: 80 }, month())).toBe(7);
  });

  it('keeps the last row below the grid, and the first above it', () => {
    expect(dayAt({ x: 60, y: 400 }, month())).toBe(7);
    expect(dayAt({ x: 60, y: -20 }, month())).toBe(0);
  });

  it('says nothing before the grid has laid out', () => {
    expect(dayAt({ x: 60, y: 10 }, [])).toBeUndefined();
  });
});

describe('dayShowingAt', () => {
  it('never answers with a day left over from a longer month', () => {
    // Thirteen boxes recorded, ten days showing now: below the grid is the tenth.
    expect(dayAt({ x: 300, y: 80 }, month())).toBe(12);
    expect(dayShowingAt({ x: 300, y: 80 }, month(), 10)).toBe(9);
  });
});
