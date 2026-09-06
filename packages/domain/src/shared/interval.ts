import { type Instant, MINUTE_MILLIS, addMinutes, instant } from './instant.js';

/**
 * A half-open span of time, `[start, end)`.
 *
 * Half-open so that adjacent spans do not overlap at the moment they touch:
 * 6–7 and 7–8 are two hours, not two hours with a disputed instant in the
 * middle. Every overlap test in the engine depends on it.
 */
export type Interval = {
  readonly start: Instant;
  readonly end: Instant;
};

export const SLOT_MINUTES = 30;
const SLOT_MILLIS = SLOT_MINUTES * MINUTE_MILLIS;

export function interval(start: Instant, end: Instant): Interval {
  if (end <= start) {
    throw new RangeError(`Interval ends before it starts: ${start} → ${end}`);
  }
  return { start, end };
}

export function durationMinutes(i: Interval): number {
  return (i.end - i.start) / MINUTE_MILLIS;
}

/**
 * Both ends fall on a half-hour boundary.
 *
 * Measured from the epoch, which is the same boundary local clocks use in every
 * zone the product supports. (Zones offset by 45 minutes — Kathmandu, Chatham —
 * would need this rethought; none is in scope, and the check would fail loudly
 * rather than quietly accept a misaligned window.)
 */
export function isAligned30(i: Interval): boolean {
  return i.start % SLOT_MILLIS === 0 && i.end % SLOT_MILLIS === 0;
}

/** `outer` covers all of `inner`. */
export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function containsInstant(i: Interval, value: Instant): boolean {
  return i.start <= value && value < i.end;
}

/** They share at least one instant. Touching at a boundary is not overlapping. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** They overlap, or one begins exactly where the other ends. */
export function touchesOrOverlaps(a: Interval, b: Interval): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Sort and coalesce. Spans that overlap *or touch* become one, because a
 * member free 6–7 and 7–8 is free 6–8 and should be offered a 90-minute slot
 * across the join.
 */
export function merge(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  let current = sorted[0]!;

  for (const next of sorted.slice(1)) {
    if (next.start <= current.end) {
      current = { start: current.start, end: next.end > current.end ? next.end : current.end };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

/** Everything in `from` that is not in `cut`. Nought, one or two spans. */
export function subtract(from: Interval, cut: Interval): Interval[] {
  if (!overlaps(from, cut)) return [from];

  const pieces: Interval[] = [];
  if (from.start < cut.start) pieces.push({ start: from.start, end: cut.start });
  if (cut.end < from.end) pieces.push({ start: cut.end, end: from.end });
  return pieces;
}

/** Everything in `from` that is not in any of `cuts`. */
export function subtractAll(from: Interval, cuts: readonly Interval[]): Interval[] {
  return merge(cuts).reduce<Interval[]>(
    (pieces, cut) => pieces.flatMap((piece) => subtract(piece, cut)),
    [from],
  );
}

/** The overlap between two spans, if there is one. */
export function intersect(a: Interval, b: Interval): Interval | null {
  if (!overlaps(a, b)) return null;
  return {
    start: (a.start > b.start ? a.start : b.start) as Instant,
    end: (a.end < b.end ? a.end : b.end) as Instant,
  };
}

/**
 * Every start instant in `range` at `stepMinutes`, from `range.start`.
 *
 * The candidate engine's outer loop (§12). It yields starts, not slots: whether
 * a start is usable depends on the duration, which is the caller's business.
 */
export function enumerateStarts(range: Interval, stepMinutes = SLOT_MINUTES): Instant[] {
  if (stepMinutes <= 0) throw new RangeError(`Step must be positive: ${stepMinutes}`);

  const starts: Instant[] = [];
  for (let at = range.start; at < range.end; at = addMinutes(at, stepMinutes)) {
    starts.push(at);
  }
  return starts;
}

/** Round down to the previous half-hour boundary. */
export function floorToSlot(value: Instant): Instant {
  return instant(Math.floor(value / SLOT_MILLIS) * SLOT_MILLIS);
}

/** Round up to the next half-hour boundary. */
export function ceilToSlot(value: Instant): Instant {
  return instant(Math.ceil(value / SLOT_MILLIS) * SLOT_MILLIS);
}
