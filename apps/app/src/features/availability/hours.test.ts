import { describe, expect, it } from 'vitest';

import { addRange, cellsOf, edgeOptions, rangesOf, removeRange, setEdge } from './hours';

/** A band of 27 half hours, 9 am to 10:30 pm. */
const LENGTH = 27;

describe('a day as From – to pairs', () => {
  it('reads the runs of cells that are on as pairs, and writes them back', () => {
    const cells = cellsOf(
      [
        { from: 6, to: 14 },
        { from: 21, to: 27 },
      ],
      LENGTH,
    );
    expect(rangesOf(cells)).toEqual([
      { from: 6, to: 14 },
      { from: 21, to: 27 },
    ]);
    expect(cells.filter(Boolean)).toHaveLength(14);
  });

  it('merges pairs that overlap or touch, as the cells they paint are one run', () => {
    expect(
      rangesOf(
        cellsOf(
          [
            { from: 2, to: 8 },
            { from: 6, to: 12 },
          ],
          LENGTH,
        ),
      ),
    ).toEqual([{ from: 2, to: 12 }]);
    expect(
      rangesOf(
        cellsOf(
          [
            { from: 2, to: 8 },
            { from: 8, to: 12 },
          ],
          LENGTH,
        ),
      ),
    ).toEqual([{ from: 2, to: 12 }]);
  });

  it('has no pairs for a day with no cells', () => {
    expect(rangesOf(new Array(LENGTH).fill(false))).toEqual([]);
  });
});

describe('what the picker offers', () => {
  it('offers From from the start of the band to a half hour before its own To', () => {
    expect(edgeOptions('from', { from: 6, to: 10 }, LENGTH)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('offers To from a half hour after its own From to the end of the band', () => {
    const options = edgeOptions('to', { from: 20, to: 24 }, LENGTH);
    expect(options[0]).toBe(21);
    expect(options[options.length - 1]).toBe(LENGTH);
  });

  it('never offers an empty or backwards pair', () => {
    expect(edgeOptions('from', { from: 0, to: 1 }, LENGTH)).toEqual([0]);
    expect(edgeOptions('to', { from: 26, to: 27 }, LENGTH)).toEqual([27]);
  });
});

describe('changing a pair', () => {
  const two = [
    { from: 6, to: 14 },
    { from: 21, to: 27 },
  ];

  it('moves one edge and leaves the rest', () => {
    expect(setEdge(two, 0, 'to', 12, LENGTH)).toEqual([
      { from: 6, to: 12 },
      { from: 21, to: 27 },
    ]);
  });

  it('merges with a neighbour it now meets or overlaps', () => {
    expect(setEdge(two, 0, 'to', 22, LENGTH)).toEqual([{ from: 6, to: 27 }]);
    expect(setEdge(two, 1, 'from', 14, LENGTH)).toEqual([{ from: 6, to: 27 }]);
  });

  it('ignores a boundary outside what the picker offers', () => {
    expect(setEdge(two, 0, 'to', 6, LENGTH)).toEqual(two);
    expect(setEdge(two, 0, 'from', 14, LENGTH)).toEqual(two);
    expect(setEdge(two, 5, 'from', 1, LENGTH)).toEqual(two);
  });

  it('adds a pair an hour long after the last one, with a half hour between', () => {
    expect(addRange([{ from: 6, to: 14 }], LENGTH)).toEqual([
      { from: 6, to: 14 },
      { from: 15, to: 17 },
    ]);
  });

  it('adds in a gap between pairs when the pairs reach both ends of the band (review round 1)', () => {
    expect(
      addRange(
        [
          { from: 0, to: 4 },
          { from: 20, to: 27 },
        ],
        LENGTH,
      ),
    ).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 7 },
      { from: 20, to: 27 },
    ]);
    // And nothing when the only room is a single half hour between two pairs.
    expect(
      addRange(
        [
          { from: 0, to: 4 },
          { from: 5, to: 27 },
        ],
        LENGTH,
      ),
    ).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 27 },
    ]);
  });

  it('adds before the first when the band ends too close, and nothing when the day is full', () => {
    expect(addRange([{ from: 10, to: 26 }], LENGTH)).toEqual([
      { from: 7, to: 9 },
      { from: 10, to: 26 },
    ]);
    expect(addRange([{ from: 0, to: 27 }], LENGTH)).toEqual([{ from: 0, to: 27 }]);
  });

  it('removes a pair, but not the only one: untapping the day is how a day goes', () => {
    expect(removeRange(two, 0)).toEqual([{ from: 21, to: 27 }]);
    expect(removeRange([{ from: 6, to: 14 }], 0)).toEqual([{ from: 6, to: 14 }]);
  });
});
