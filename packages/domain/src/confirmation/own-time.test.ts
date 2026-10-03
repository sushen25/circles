import { describe, expect, it } from 'vitest';

import { MELBOURNE } from '../shared/fixtures.js';
import { addMinutes, fromISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import {
  OWN_TIME_LOOKAHEAD_DAYS,
  lastOwnTimeDay,
  ownTimeCautions,
  ownTimeProblem,
} from './own-time.js';

const plan = {
  zone: MELBOURNE,
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
  quorum: 4,
};
const NOW = fromISO('2026-09-14T00:00:00Z');
const at = (date: string, hour: number, minute = 0) =>
  fromLocal(localDate(date), hour * 60 + minute, MELBOURNE);

describe('ownTimeProblem', () => {
  it('accepts a Friday evening, which is not an option and not on the plan', () => {
    const start = at('2026-09-18', 19);
    expect(ownTimeProblem(plan, start, addMinutes(start, 120), NOW)).toBeUndefined();
  });

  it('refuses a stretch off the half hour, ahead of every other problem', () => {
    const start = addMinutes(at('2026-09-18', 19), 10);
    expect(ownTimeProblem(plan, start, addMinutes(start, 120), NOW)).toBe(
      'own_time_off_the_half_hour',
    );
    // Off at the far end only.
    const aligned = at('2026-09-18', 19);
    expect(ownTimeProblem(plan, aligned, addMinutes(aligned, 125), NOW)).toBe(
      'own_time_off_the_half_hour',
    );
  });

  it('holds the length to 30 minutes at least and 5 hours at most', () => {
    const start = at('2026-09-18', 12);
    expect(ownTimeProblem(plan, start, start, NOW)).toBe('own_time_ends_before_it_starts');
    expect(ownTimeProblem(plan, start, addMinutes(start, -60), NOW)).toBe(
      'own_time_ends_before_it_starts',
    );
    expect(ownTimeProblem(plan, start, addMinutes(start, 30), NOW)).toBeUndefined();
    expect(ownTimeProblem(plan, start, addMinutes(start, 300), NOW)).toBeUndefined();
    expect(ownTimeProblem(plan, start, addMinutes(start, 330), NOW)).toBe('own_time_too_long');
  });

  it('refuses a start that is not in the future', () => {
    const start = at('2026-09-18', 19);
    expect(ownTimeProblem(plan, start, addMinutes(start, 60), start)).toBe('own_time_in_the_past');
    expect(ownTimeProblem(plan, start, addMinutes(start, 60), addMinutes(start, 30))).toBe(
      'own_time_in_the_past',
    );
  });

  it("allows any day to the plan's last day plus 30, and refuses the day after", () => {
    expect(lastOwnTimeDay(plan)).toBe('2026-10-27');
    expect(OWN_TIME_LOOKAHEAD_DAYS).toBe(30);
    const last = at('2026-10-27', 23);
    expect(ownTimeProblem(plan, last, addMinutes(last, 30), NOW)).toBeUndefined();
    const after = at('2026-10-28', 9);
    expect(ownTimeProblem(plan, after, addMinutes(after, 60), NOW)).toBe('own_time_too_far_ahead');
  });

  it("reads the last day on the plan's clock, not UTC", () => {
    // 11 pm Melbourne on the 27th October is the 27th at 12:00 UTC the same day,
    // and 1 am on the 28th Melbourne is still the 27th in UTC: the clock is the plan's.
    const lateInMelbourne = at('2026-10-28', 1);
    expect(ownTimeProblem(plan, lateInMelbourne, addMinutes(lateInMelbourne, 60), NOW)).toBe(
      'own_time_too_far_ahead',
    );
  });
});

describe('ownTimeCautions', () => {
  it('says below the number only when fewer can make it than the plan asked for', () => {
    const start = at('2026-09-18', 19);
    expect(ownTimeCautions(plan, start, 3).belowQuorum).toBe(true);
    expect(ownTimeCautions(plan, start, 4).belowQuorum).toBe(false);
  });

  it('says outside the plan for a day the plan never asked about, and not for one it did', () => {
    expect(ownTimeCautions(plan, at('2026-09-26', 19), 6).outsidePlanDays).toBe(false);
    expect(ownTimeCautions(plan, at('2026-10-03', 19), 6).outsidePlanDays).toBe(true);
    const gaps = {
      ...plan,
      window: { ...plan.window, days: [localDate('2026-09-14'), localDate('2026-09-27')] },
    };
    expect(ownTimeCautions(gaps, at('2026-09-20', 19), 6).outsidePlanDays).toBe(true);
  });
});
