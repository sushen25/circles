import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { plan } from '../planning/fixtures.js';
import { isErr, isOk } from '../shared/result.js';
import { type Interval, durationMinutes, interval, isAligned30 } from '../shared/interval.js';
import { localDate } from '../shared/local-date.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { fromLocal, toLocal } from '../shared/zone.js';
import {
  canHostDuration,
  isWithinPlan,
  normaliseWindows,
  planBounds,
  planDays,
  totalMinutes,
} from './windows.js';

/** A window on one of the plan's days, in local minutes. */
const on = (date: string, fromMin: number, toMin: number): Interval =>
  interval(
    fromLocal(localDate(date), fromMin, MELBOURNE),
    fromLocal(localDate(date), toMin, MELBOURNE),
  );

describe('planDays', () => {
  it('is one span per day of the window', () => {
    expect(planDays(plan())).toHaveLength(7); // 14–20 September
  });

  it('holds the local band across a daylight-saving change', () => {
    // Melbourne moves to daylight time on Sunday 4 October 2026.
    const across = plan({
      window: { start: localDate('2026-10-03'), end: localDate('2026-10-05') },
    });
    for (const day of planDays(across)) {
      expect(toLocal(day.start, MELBOURNE).minutesOfDay).toBe(17 * 60 + 30);
      expect(toLocal(day.end, MELBOURNE).minutesOfDay).toBe(22 * 60 + 30);
    }
  });

  it('makes the day the clocks change shorter in real time, not in local time', () => {
    const across = plan({
      window: { start: localDate('2026-10-04'), end: localDate('2026-10-04') },
      daily: { startMin: 0 + 60, endMin: 23 * 60 },
    });
    const day = planDays(across)[0] as Interval;
    // 01:00 to 23:00 local across a spring-forward is 21 hours, not 22.
    expect(durationMinutes(day)).toBe(21 * 60);
  });
});

describe('normaliseWindows', () => {
  const p = plan(); // 14–20 Sep, 17:30–22:30 Melbourne, 120 min

  it('keeps a window that is already clean', () => {
    const result = normaliseWindows([on('2026-09-17', 18 * 60, 20 * 60)], p);
    expect(isOk(result) && result.value).toHaveLength(1);
  });

  it('rounds inward, never outward — it must not invent availability', () => {
    // 18:07–19:52 becomes 18:30–19:30.
    const result = normaliseWindows([on('2026-09-17', 18 * 60 + 7, 19 * 60 + 52)], p);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const [only] = result.value;
      expect(toLocal((only as Interval).start, MELBOURNE).minutesOfDay).toBe(18 * 60 + 30);
      expect(toLocal((only as Interval).end, MELBOURNE).minutesOfDay).toBe(19 * 60 + 30);
    }
  });

  it('drops a stray tap smaller than a slot rather than erroring', () => {
    const result = normaliseWindows([on('2026-09-17', 18 * 60 + 5, 18 * 60 + 20)], p);
    expect(isOk(result) && result.value).toEqual([]);
  });

  it('clips a window that overhangs the daily band', () => {
    const result = normaliseWindows([on('2026-09-17', 16 * 60, 23 * 60 + 30)], p);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const [only] = result.value;
      expect(toLocal((only as Interval).start, MELBOURNE).minutesOfDay).toBe(17 * 60 + 30);
      expect(toLocal((only as Interval).end, MELBOURNE).minutesOfDay).toBe(22 * 60 + 30);
    }
  });

  it('merges windows that touch, so a 90-minute slot can span the join', () => {
    const result = normaliseWindows(
      [on('2026-09-17', 18 * 60, 19 * 60), on('2026-09-17', 19 * 60, 20 * 60)],
      p,
    );
    expect(isOk(result) && result.value).toHaveLength(1);
    expect(isOk(result) && durationMinutes(result.value[0] as Interval)).toBe(120);
  });

  it('splits a window that spans two days into one per day', () => {
    // 17:30 on the 17th to 22:30 on the 18th: the overnight hours are not in
    // the band, so this is two evenings, not one 29-hour block.
    const overnight = interval(
      fromLocal(localDate('2026-09-17'), 17 * 60 + 30, MELBOURNE),
      fromLocal(localDate('2026-09-18'), 22 * 60 + 30, MELBOURNE),
    );
    const result = normaliseWindows([overnight], p);
    expect(isOk(result) && result.value).toHaveLength(2);
  });

  it('errors on a window entirely outside the plan, rather than silently dropping it', () => {
    const result = normaliseWindows([on('2026-10-01', 18 * 60, 20 * 60)], p);
    expect(isErr(result) && result.error.code).toBe('outside_plan_window');
  });

  it('errors on a zero-length or backwards window', () => {
    // `interval()` refuses to build one, so this can only arrive from outside —
    // a wire payload or a hand-built object. That is exactly why the guard is
    // here rather than left to the constructor.
    const at = fromLocal(localDate('2026-09-17'), 20 * 60, MELBOURNE);
    const zeroLength = { start: at, end: at } as Interval;
    expect(isErr(normaliseWindows([zeroLength], p))).toBe(true);

    const backwards = { start: at, end: (at - 3_600_000) as typeof at } as Interval;
    const result = normaliseWindows([backwards], p);
    expect(isErr(result) && result.error.code).toBe('not_a_window');
  });

  it('always produces aligned, sorted, non-overlapping windows inside the plan', () => {
    const bounds = planBounds(p);
    const anyInstant = fc.integer({ min: bounds.start - 86_400_000, max: bounds.end + 86_400_000 });

    fc.assert(
      fc.property(fc.array(fc.tuple(anyInstant, anyInstant), { maxLength: 8 }), (pairs) => {
        const raw = pairs
          .map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }) as Interval)
          .filter((w) => w.end > w.start);

        const result = normaliseWindows(raw, p);
        if (!isOk(result)) return; // an out-of-plan window is a legitimate error

        const windows = result.value;
        for (const w of windows) {
          expect(isAligned30(w)).toBe(true);
          expect(w.end).toBeGreaterThan(w.start);
          expect(isWithinPlan(w, p)).toBe(true);
        }
        for (let i = 1; i < windows.length; i += 1) {
          // Sorted, and not merely non-overlapping: a gap must exist, or merge
          // would have joined them.
          expect((windows[i] as Interval).start).toBeGreaterThan((windows[i - 1] as Interval).end);
        }
      }),
    );
  });
});

describe('helpers', () => {
  it('adds up the time offered', () => {
    expect(totalMinutes([on('2026-09-17', 18 * 60, 20 * 60)])).toBe(120);
    expect(totalMinutes([])).toBe(0);
  });

  it('knows whether any single window can hold the meetup', () => {
    const two = [on('2026-09-17', 18 * 60, 19 * 60), on('2026-09-18', 18 * 60, 19 * 60)];
    // Two separate hours cannot host a two-hour meetup.
    expect(canHostDuration(two, 120)).toBe(false);
    expect(canHostDuration([on('2026-09-17', 18 * 60, 20 * 60)], 120)).toBe(true);
  });
});
