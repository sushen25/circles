/**
 * The availability track's logic, kept separate from its rendering so it can be
 * reasoned about and tested on its own.
 *
 * A day is ten half-hour cells. The fill is the affordance; the range in words
 * is the answer (manifesto §5.4), so producing that text is this module's real
 * job — nothing is ever communicated by the fill alone.
 */
export const SLOT_MINUTES = 30;

export type Range = { from: number; to: number };

/** Contiguous runs of selected cells, as half-open index ranges. */
export function toRanges(cells: readonly boolean[]): Range[] {
  const ranges: Range[] = [];
  let start: number | null = null;

  cells.forEach((on, index) => {
    if (on && start === null) start = index;
    if (!on && start !== null) {
      ranges.push({ from: start, to: index });
      start = null;
    }
  });
  if (start !== null) ranges.push({ from: start, to: cells.length });

  return ranges;
}

/**
 * Apply a paint stroke. `mode` is decided once, when the stroke starts, from
 * the cell first touched — so dragging across a mixed selection sets it all one
 * way rather than inverting each cell it crosses.
 */
export function paint(cells: readonly boolean[], index: number, mode: boolean): boolean[] {
  if (index < 0 || index >= cells.length) return [...cells];
  const next = [...cells];
  next[index] = mode;
  return next;
}

/** Every cell between two indices, inclusive, set to `mode`. */
export function paintSpan(
  cells: readonly boolean[],
  from: number,
  to: number,
  mode: boolean,
): boolean[] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(cells.length - 1, Math.max(from, to));
  const next = [...cells];
  for (let i = lo; i <= hi; i += 1) next[i] = mode;
  return next;
}

export type TimeFormatter = (minutesFromMidnight: number) => string;

/** Device locale and 12/24-hour preference; never a hardcoded clock. */
export function defaultTimeFormatter(): TimeFormatter {
  const format = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return (minutes) => {
    const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
    return format.format(new Date(date.getTime() + date.getTimezoneOffset() * 60_000));
  };
}

/**
 * "6:30–10:30 pm" for one run, runs joined by commas for several, and a plain
 * sentence when nothing is picked. The day period is dropped from the start of
 * a range when both ends share it, the way the canvas sets it.
 */
export function rangeLabel(
  cells: readonly boolean[],
  startMinutes: number,
  format: TimeFormatter = defaultTimeFormatter(),
  none = 'Not this day',
): string {
  const ranges = toRanges(cells);
  if (ranges.length === 0) return none;

  return ranges
    .map(({ from, to }) => {
      const start = format(startMinutes + from * SLOT_MINUTES);
      const end = format(startMinutes + to * SLOT_MINUTES);
      return `${trimSharedSuffix(start, end)}–${end}`;
    })
    .join(', ');
}

/** Drops "pm" from "6:30 pm" when the other end is also "pm". */
function trimSharedSuffix(start: string, end: string): string {
  const startSuffix = start.match(/[^\d\s:]+\s*$/)?.[0]?.trim();
  const endSuffix = end.match(/[^\d\s:]+\s*$/)?.[0]?.trim();
  if (startSuffix && startSuffix === endSuffix) {
    return start.slice(0, start.length - startSuffix.length).trim();
  }
  return start;
}

/** What a screen reader says for one cell. */
export function cellLabel(
  dayLabel: string,
  index: number,
  startMinutes: number,
  format: TimeFormatter = defaultTimeFormatter(),
): string {
  const from = format(startMinutes + index * SLOT_MINUTES);
  const to = format(startMinutes + (index + 1) * SLOT_MINUTES);
  return `${dayLabel}, ${from} to ${to}`;
}
