/**
 * A day's hours as From – to pairs (SUS-206, ADR 0068): the way the screen sets
 * a day's half-hour cells (ADR 0009 stays the data model; only the painting
 * goes). A pair is a half-open range of cell boundaries: `from` 3, `to` 8 is
 * cells 3 to 7. Boundary 0 is the band's start and boundary `length` its end.
 *
 * Pure, so the edge cases are tested without rendering: the bounds a picker
 * offers, a pair that would run into another, and a day left with nothing.
 */
export type Range = { from: number; to: number };

/** The runs of cells that are on, as pairs, in time order. */
export function rangesOf(cells: readonly boolean[]): Range[] {
  const ranges: Range[] = [];
  cells.forEach((on, index) => {
    if (!on) return;
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.to === index) last.to = index + 1;
    else ranges.push({ from: index, to: index + 1 });
  });
  return ranges;
}

/**
 * The cells the pairs cover. Overlapping or touching pairs merge, because they
 * are painted onto the same cells and `rangesOf` reads them back as one.
 */
export function cellsOf(ranges: readonly Range[], length: number): boolean[] {
  const cells = new Array<boolean>(length).fill(false);
  for (const { from, to } of ranges) {
    for (let i = Math.max(0, from); i < Math.min(length, to); i += 1) cells[i] = true;
  }
  return cells;
}

/**
 * The boundaries a picker offers for one edge of pair `index`: `from` anywhere
 * before its own `to`, `to` anywhere after its own `from` (at least one half
 * hour: the domain keeps no minimum for a window, only that a meetup fits in
 * one somewhere, `canHostDuration`), always inside the band. Where it runs into
 * a neighbour the pairs merge, so the neighbour is not a bound.
 */
export function edgeOptions(which: 'from' | 'to', range: Range, length: number): number[] {
  const [low, high] = which === 'from' ? [0, range.to - 1] : [range.from + 1, length];
  return Array.from({ length: Math.max(0, high - low + 1) }, (_, i) => low + i);
}

/** Pair `index` with one edge moved, merged with any it now meets. */
export function setEdge(
  ranges: readonly Range[],
  index: number,
  which: 'from' | 'to',
  boundary: number,
  length: number,
): Range[] {
  const range = ranges[index];
  if (range === undefined || !edgeOptions(which, range, length).includes(boundary)) {
    return [...ranges];
  }
  const moved = ranges.map((r, i) => (i === index ? { ...r, [which]: boundary } : r));
  return rangesOf(cellsOf(moved, length));
}

/**
 * Another pair, for a gap in the day: an hour (two cells) starting a half hour
 * after the last pair ends, or ending a half hour before the first pair starts
 * when the band's end is too close, or nothing when the day has no room. The
 * half hour between keeps it from merging the moment it is added.
 */
export function addRange(ranges: readonly Range[], length: number): Range[] {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (last !== undefined && last.to + 1 < length) {
    return [...ranges, { from: last.to + 1, to: Math.min(last.to + 3, length) }];
  }
  if (first !== undefined && first.from >= 2) {
    return [{ from: Math.max(first.from - 3, 0), to: first.from - 1 }, ...ranges];
  }
  return [...ranges];
}

/** Pair `index` taken away. The only pair is left alone: untapping the day is how a day goes. */
export function removeRange(ranges: readonly Range[], index: number): Range[] {
  return ranges.length <= 1 ? [...ranges] : ranges.filter((_, i) => i !== index);
}
