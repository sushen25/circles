import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Instant, MINUTE_MILLIS, instant } from './instant';
import {
  type Interval,
  ceilToSlot,
  contains,
  containsInstant,
  durationMinutes,
  enumerateStarts,
  floorToSlot,
  intersect,
  interval,
  isAligned30,
  merge,
  overlaps,
  subtract,
  subtractAll,
} from './interval';

const SLOT = 30 * MINUTE_MILLIS;
const base = Date.UTC(2026, 8, 17) as Instant;
/** Interval `n` to `m` half-hour slots after the base moment. */
const iv = (from: number, to: number): Interval =>
  interval(instant(base + from * SLOT), instant(base + to * SLOT));

/** Arbitrary intervals on the half-hour grid, which is all the product makes. */
const anInterval = fc
  .tuple(fc.integer({ min: 0, max: 96 }), fc.integer({ min: 1, max: 8 }))
  .map(([from, length]) => iv(from, from + length));

describe('interval', () => {
  it('refuses to end before it starts', () => {
    expect(() => interval(instant(base + SLOT), instant(base))).toThrow(/ends before it starts/);
    expect(() => interval(instant(base), instant(base))).toThrow();
  });

  it('is half-open, so touching spans do not overlap', () => {
    expect(overlaps(iv(0, 2), iv(2, 4))).toBe(false);
    expect(overlaps(iv(0, 2), iv(1, 3))).toBe(true);
    expect(containsInstant(iv(0, 2), instant(base))).toBe(true);
    expect(containsInstant(iv(0, 2), instant(base + 2 * SLOT))).toBe(false);
  });

  it('measures its own length', () => {
    expect(durationMinutes(iv(0, 4))).toBe(120);
  });

  it('knows when one covers another', () => {
    expect(contains(iv(0, 4), iv(1, 3))).toBe(true);
    expect(contains(iv(0, 4), iv(0, 4))).toBe(true);
    expect(contains(iv(0, 4), iv(3, 5))).toBe(false);
  });

  it('checks half-hour alignment', () => {
    expect(isAligned30(iv(0, 2))).toBe(true);
    expect(isAligned30(interval(instant(base + 60_000), instant(base + SLOT)))).toBe(false);
  });
});

describe('merge', () => {
  it('coalesces overlapping and touching spans', () => {
    expect(merge([iv(0, 2), iv(2, 4)])).toEqual([iv(0, 4)]);
    expect(merge([iv(0, 3), iv(1, 5)])).toEqual([iv(0, 5)]);
    expect(merge([iv(0, 2), iv(4, 6)])).toEqual([iv(0, 2), iv(4, 6)]);
  });

  it('is idempotent — merging a merged list changes nothing', () => {
    fc.assert(
      fc.property(fc.array(anInterval, { maxLength: 20 }), (intervals) => {
        const once = merge(intervals);
        expect(merge(once)).toEqual(once);
      }),
    );
  });

  it('does not care what order it is given', () => {
    fc.assert(
      fc.property(fc.array(anInterval, { maxLength: 20 }), (intervals) => {
        const forwards = merge(intervals);
        const backwards = merge([...intervals].reverse());
        expect(backwards).toEqual(forwards);
      }),
    );
  });

  it('never loses or invents time', () => {
    fc.assert(
      fc.property(fc.array(anInterval, { minLength: 1, maxLength: 20 }), (intervals) => {
        const merged = merge(intervals);

        // Every original moment is still covered.
        for (const original of intervals) {
          expect(merged.some((m) => contains(m, original))).toBe(true);
        }
        // The result is sorted and strictly separated.
        for (let i = 1; i < merged.length; i += 1) {
          expect(merged[i]!.start).toBeGreaterThan(merged[i - 1]!.end);
        }
      }),
    );
  });

  it('has nothing to say about an empty list', () => {
    expect(merge([])).toEqual([]);
  });
});

describe('subtract', () => {
  it('cuts a hole in the middle', () => {
    expect(subtract(iv(0, 6), iv(2, 4))).toEqual([iv(0, 2), iv(4, 6)]);
  });

  it('trims an end', () => {
    expect(subtract(iv(0, 6), iv(4, 8))).toEqual([iv(0, 4)]);
    expect(subtract(iv(2, 6), iv(0, 4))).toEqual([iv(4, 6)]);
  });

  it('removes everything, or nothing', () => {
    expect(subtract(iv(2, 4), iv(0, 6))).toEqual([]);
    expect(subtract(iv(0, 2), iv(4, 6))).toEqual([iv(0, 2)]);
  });

  it('takes several cuts at once', () => {
    expect(subtractAll(iv(0, 10), [iv(2, 3), iv(6, 7)])).toEqual([iv(0, 2), iv(3, 6), iv(7, 10)]);
  });

  it('leaves nothing a cut covered', () => {
    fc.assert(
      fc.property(anInterval, fc.array(anInterval, { maxLength: 6 }), (from, cuts) => {
        for (const piece of subtractAll(from, cuts)) {
          for (const cut of cuts) {
            expect(overlaps(piece, cut)).toBe(false);
          }
        }
      }),
    );
  });
});

describe('intersect', () => {
  it('finds the shared part, or nothing', () => {
    expect(intersect(iv(0, 4), iv(2, 6))).toEqual(iv(2, 4));
    expect(intersect(iv(0, 2), iv(2, 4))).toBeNull();
  });
});

describe('enumerateStarts', () => {
  it('walks the range at the step, excluding the end', () => {
    const starts = enumerateStarts(iv(0, 3));
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe(base);
    expect(starts.at(-1)).toBe(base + 2 * SLOT);
  });

  it('takes a coarser step', () => {
    expect(enumerateStarts(iv(0, 4), 60)).toHaveLength(2);
  });

  it('refuses a step that would not terminate', () => {
    expect(() => enumerateStarts(iv(0, 2), 0)).toThrow(/must be positive/);
  });

  it('covers a fortnight of half-hour starts without complaint', () => {
    // The engine's real shape: 14 days × 48 slots (§12).
    expect(enumerateStarts(iv(0, 14 * 48))).toHaveLength(672);
  });
});

describe('slot rounding', () => {
  it('floors and ceils to the half hour', () => {
    const ragged = instant(base + 7 * MINUTE_MILLIS);
    expect(floorToSlot(ragged)).toBe(base);
    expect(ceilToSlot(ragged)).toBe(base + SLOT);
    expect(floorToSlot(instant(base))).toBe(base);
    expect(ceilToSlot(instant(base))).toBe(base);
  });
});
