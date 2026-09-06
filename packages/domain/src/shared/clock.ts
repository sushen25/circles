import { type Instant, fromISO, instant } from './instant.js';

/**
 * Reading the time is I/O, and the domain does no I/O.
 *
 * Every rule that depends on "now" — deadlines passing, starts in the past,
 * cadence falling due — takes a `Clock`. That is what makes those rules
 * testable at a chosen moment instead of only at the moment the test happens to
 * run, and it is why the engine is deterministic.
 */
export type Clock = {
  now(): Instant;
};

/** The real one. Used at the edges, never inside a rule. */
export const systemClock: Clock = {
  now: () => instant(Date.now()),
};

/** A clock stopped at a chosen moment. */
export function fixedClock(at: Instant | string): Clock {
  const frozen = typeof at === 'string' ? fromISO(at) : at;
  return { now: () => frozen };
}

/**
 * A clock that can be moved by hand, for tests that need time to pass without
 * waiting for it.
 */
export function mutableClock(at: Instant | string): Clock & { advanceMinutes(n: number): void } {
  let current = typeof at === 'string' ? fromISO(at) : at;
  return {
    now: () => current,
    advanceMinutes(n: number) {
      current = instant(current + n * 60_000);
    },
  };
}
