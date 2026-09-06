import { type Instant, fromISO } from './instant.js';
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
 * The shapes here are structural placeholders. Each Slice 1 domain ticket owns
 * its aggregate and will replace the corresponding type with the real one; the
 * builder names are fixed now so those tickets change a type rather than every
 * test that used it.
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

type Overrides<T> = Partial<T>;

export type CircleFixture = {
  id: string;
  name: string;
  timeZone: Zone;
  quorum: number;
  durationMinutes: number;
  cadence: 'weekly' | 'fortnightly' | 'monthly' | 'two_monthly' | 'none';
};

export function circle(overrides: Overrides<CircleFixture> = {}): CircleFixture {
  return {
    id: 'circle-1',
    name: 'Sunday Crew',
    timeZone: MELBOURNE,
    quorum: 3,
    durationMinutes: 120,
    cadence: 'monthly',
    ...overrides,
  };
}

export type MemberFixture = {
  id: string;
  circleId: string;
  name: string;
  role: 'owner' | 'member';
  status: 'active' | 'removed';
  /** Members can sit in other zones; the engine has to cope (§12). */
  timeZone: Zone;
};

export function member(overrides: Overrides<MemberFixture> = {}): MemberFixture {
  return {
    id: 'member-1',
    circleId: 'circle-1',
    name: 'Maya',
    role: 'member',
    status: 'active',
    timeZone: MELBOURNE,
    ...overrides,
  };
}

export type PlanFixture = {
  id: string;
  circleId: string;
  mode: 'named' | 'quiet';
  window: Interval;
  durationMinutes: number;
  quorum: number;
  responseDeadline: Instant;
};

export function plan(overrides: Overrides<PlanFixture> = {}): PlanFixture {
  return {
    id: 'plan-1',
    circleId: 'circle-1',
    mode: 'named',
    window: interval(
      fromLocal(localDate('2026-09-14'), 0, MELBOURNE),
      fromLocal(localDate('2026-09-28'), 0, MELBOURNE),
    ),
    durationMinutes: 120,
    quorum: 3,
    responseDeadline: fromISO('2026-09-15T08:00:00.000Z'),
    ...overrides,
  };
}

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

export type ResponseFixture = {
  id: string;
  planId: string;
  memberId: string;
  status: 'windows' | 'flexible' | 'none_work';
  windows: readonly Interval[];
};

export function response(overrides: Overrides<ResponseFixture> = {}): ResponseFixture {
  return {
    id: 'response-1',
    planId: 'plan-1',
    memberId: 'member-1',
    status: 'windows',
    windows: [window()],
    ...overrides,
  };
}
