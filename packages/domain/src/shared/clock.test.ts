import { describe, expect, it } from 'vitest';

import { fixedClock, mutableClock, systemClock } from './clock';
import { toISO } from './instant';

describe('Clock', () => {
  it('stops at a chosen moment, so a rule can be tested at that moment', () => {
    const clock = fixedClock('2026-09-17T08:30:00.000Z');
    expect(toISO(clock.now())).toBe('2026-09-17T08:30:00.000Z');
    expect(clock.now()).toBe(clock.now());
  });

  it('can be moved by hand, without waiting', () => {
    const clock = mutableClock('2026-09-17T08:30:00.000Z');
    clock.advanceMinutes(90);
    expect(toISO(clock.now())).toBe('2026-09-17T10:00:00.000Z');
  });

  it('reads the real time at the edges', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});
