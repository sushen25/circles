/**
 * Where a finger is on the DayGrid, as a day (ADR 00ZZ's drag).
 *
 * Pure, so the arithmetic is tested without a touch screen: the grid records
 * each day's box as it lays out, relative to the grid's own top-left, and a
 * stroke asks which day a point is over. A stroke crosses rows, so this is a
 * two-dimensional question — the half-hour `Track` only ever asks it along x.
 *
 * Between days, or past the last of them, the nearest day in calendar order
 * answers: a finger in the gap between two days, or below the last week, has
 * not left the grid, and a stroke that dropped it would stutter.
 */
export type DayBox = { x: number; y: number; width: number; height: number };

export function dayAt(
  point: { x: number; y: number },
  boxes: readonly (DayBox | undefined)[],
): number | undefined {
  let row: number | undefined;
  // The row the point is in: the last whose top is above it.
  const tops = [...new Set(boxes.flatMap((box) => (box === undefined ? [] : [box.y])))].sort(
    (a, b) => a - b,
  );
  if (tops.length === 0) return undefined;
  row = tops[0];
  for (const top of tops) if (point.y >= top) row = top;

  let best: number | undefined;
  let distance = Infinity;
  boxes.forEach((box, index) => {
    if (box === undefined || box.y !== row) return;
    const from =
      point.x < box.x
        ? box.x - point.x
        : point.x > box.x + box.width
          ? point.x - (box.x + box.width)
          : 0;
    if (from < distance) {
      distance = from;
      best = index;
    }
  });
  return best;
}
