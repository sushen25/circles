import type { Instant } from './instant.js';
import { type Interval, interval } from './interval.js';
import { type LocalDate, localDate } from './local-date.js';
import { type Zone, fromLocal, zone } from './zone.js';

/**
 * Builders for test data. Never copied JSON (architecture §7.1).
 *
 * Every builder takes overrides and fills the rest, so a test states only what
 * it is about: `plan({ quorum: 2 })` says "this test is about quorum" and stays
 * readable when a field is added later.
 *
 * The shapes still here are structural placeholders. Each Slice 1 domain ticket
 * owns its aggregate and replaces the corresponding type with the real one —
 * S1-01 did that for `circle` and `member`, S1-02 for `plan`, S1-03 for
 * `response`; each lives in its own context's `fixtures.ts`. What stays here
 * is the shared value-object builders: `window`, and the canvas's example
 * dates. `src/fixtures.ts` aggregates both, so callers still
 * write `fixtures.circle()`.
 *
 * They live in the domain package rather than a root `tests/fixtures` (the
 * architecture's layout) so they are typed against the domain without alias
 * plumbing, and so Slice 1's domain tests can import them from the package they
 * are already testing. End-to-end fixtures can re-export from here.
 */

export const MELBOURNE = zone('Australia/Melbourne');

/** A Thursday, deliberately: the canvas's examples are Thursday 17 September. */
export const A_THURSDAY: LocalDate = localDate('2026-09-17');

/** 6:30 pm Melbourne on that Thursday — the canvas's confirmed time. */
export const AN_EVENING: Instant = fromLocal(A_THURSDAY, 18 * 60 + 30, MELBOURNE);

export type WindowFixture = Interval;

/** A willing window on a given local date, in minutes of the day. */
export function window(
  date: LocalDate = A_THURSDAY,
  fromMinutes = 17 * 60 + 30,
  toMinutes = 22 * 60 + 30,
  inZone: Zone = MELBOURNE,
): WindowFixture {
  return interval(fromLocal(date, fromMinutes, inZone), fromLocal(date, toMinutes, inZone));
}
