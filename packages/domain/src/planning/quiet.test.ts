import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ALEX, JESS, NIC, PRIYA, SAM, TOM } from '../scheduling/fixtures.js';
import { addMinutes } from '../shared/instant.js';
import { FRIDAY_MIDDAY, TOM_ASKS, quietAsk, quietPlan } from './fixtures.js';
import {
  type QuietAskRequest,
  type RecentQuietAsk,
  QUIET_LIMITS,
  canCreateQuietAsk,
  keenCount,
  quietThreshold,
  recordInterest,
  thresholdMet,
} from './quiet.js';

const DAY = 24 * 60;
const FREE = { now: TOM_ASKS, circleHasOpenPlan: false } as const;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('quietThreshold', () => {
  it.each([
    [2, 2],
    [3, 3],
    [4, 3],
    [6, 3],
    [12, 3],
    [13, 4],
    [16, 4],
    [17, 5],
    [20, 5],
  ])('a circle of %i needs %i keen', (members, threshold) => {
    expect(quietThreshold(members)).toBe(threshold);
  });

  it('is three for every circle the spec drew it for, up to the old cap of twelve', () => {
    for (let n = 3; n <= 12; n += 1) expect(quietThreshold(n)).toBe(3);
  });

  it('never exceeds the circle, never falls below a quarter of it, and never falls as it grows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), (n) => {
        const t = quietThreshold(n);
        expect(t).toBeLessThanOrEqual(n);
        expect(t).toBeGreaterThanOrEqual(Math.min(n, Math.ceil(n / 4)));
        expect(t).toBeGreaterThanOrEqual(quietThreshold(n - 1));
      }),
    );
  });

  it('refuses a count that is not one', () => {
    expect(() => quietThreshold(-1)).toThrow(RangeError);
    expect(() => quietThreshold(2.5)).toThrow(RangeError);
  });
});

describe('canCreateQuietAsk', () => {
  const request = (overrides: Partial<QuietAskRequest> = {}): QuietAskRequest => ({
    member: { isPermanent: true, isMember: true, mutedQuietAsks: false },
    circle: { status: 'active', activeMembers: 6 },
    circleHasOpenPlan: false,
    recentAsks: [],
    now: TOM_ASKS,
    ...overrides,
  });
  const ask = (daysAgo: number, overrides: Partial<RecentQuietAsk> = {}): RecentQuietAsk => ({
    createdAt: addMinutes(TOM_ASKS, -daysAgo * DAY),
    state: 'expired',
    mine: false,
    ...overrides,
  });

  it('allows a saved-place member of an active circle with nothing running', () => {
    expect(canCreateQuietAsk(request())).toBe('allowed');
  });

  it('a fourth ask in seven days fails, whoever made the three', () => {
    const three = [ask(1), ask(3, { state: 'cancelled' }), ask(6, { state: 'collecting' })];
    expect(canCreateQuietAsk(request({ recentAsks: three.slice(0, 2) }))).toBe('allowed');
    expect(canCreateQuietAsk(request({ recentAsks: three }))).toBe('circle_ask_limit');
  });

  it('counts a rolling seven days: an ask made exactly seven days ago has dropped out', () => {
    expect(canCreateQuietAsk(request({ recentAsks: [ask(1), ask(2), ask(7)] }))).toBe('allowed');
    expect(canCreateQuietAsk(request({ recentAsks: [ask(1), ask(2), ask(6.99)] }))).toBe(
      'circle_ask_limit',
    );
  });

  it('a second concurrent ask by the same member fails', () => {
    const mine = ask(0.5, { state: 'seeking', mine: true });
    expect(canCreateQuietAsk(request({ recentAsks: [mine] }))).toBe('already_asking');
  });

  it("another member's running ask does not stop this one, and a finished one of mine does not", () => {
    const theirs = ask(0.5, { state: 'seeking' });
    const mineDone = ask(2, { state: 'expired', mine: true });
    expect(canCreateQuietAsk(request({ recentAsks: [theirs, mineDone] }))).toBe('allowed');
  });

  it('the limits do not grow with the circle: twenty members still get three a week', () => {
    const twenty = request({ circle: { status: 'active', activeMembers: 20 } });
    expect(QUIET_LIMITS.perCircle).toBe(3);
    expect(canCreateQuietAsk({ ...twenty, recentAsks: [ask(1), ask(2), ask(3)] })).toBe(
      'circle_ask_limit',
    );
  });

  it.each([
    [
      { member: { isPermanent: false, isMember: true, mutedQuietAsks: false } },
      'needs_saved_place',
    ],
    [{ member: { isPermanent: true, isMember: false, mutedQuietAsks: false } }, 'needs_membership'],
    [{ circle: { status: 'archived', activeMembers: 6 } }, 'circle_archived'],
    [{ member: { isPermanent: true, isMember: true, mutedQuietAsks: true } }, 'quiet_asks_muted'],
    [{ circle: { status: 'active', activeMembers: 1 } }, 'nobody_to_ask'],
    [{ circleHasOpenPlan: true }, 'plan_in_progress'],
    [{ circleHasOpenPlan: undefined }, 'plan_in_progress'],
  ] as const)('refuses %j with %s', (overrides, reason) => {
    expect(canCreateQuietAsk(request(overrides as Partial<QuietAskRequest>))).toBe(reason);
  });

  it('tells a member who muted quiet asks that, and not that the circle is at its limit', () => {
    const muted = request({
      member: { isPermanent: true, isMember: true, mutedQuietAsks: true },
      recentAsks: [ask(1), ask(2), ask(3)],
    });
    expect(canCreateQuietAsk(muted)).toBe('quiet_asks_muted');
  });
});

describe('recordInterest', () => {
  it('counts the initiator as keen from creation', () => {
    const ask = quietAsk();
    expect(keenCount(ask)).toBe(1);
  });

  it('reaches the threshold on the third keen answer, the initiator included', () => {
    const one = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', FREE));
    expect(one.thresholdReached).toBe(false);
    const two = unwrap(recordInterest(one.ask, JESS, 'keen', FREE));
    expect(two.thresholdReached).toBe(true);
    expect(keenCount(two.ask)).toBe(3);
  });

  it('is idempotent per member: the same answer twice changes nothing', () => {
    const once = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', FREE));
    const twice = unwrap(recordInterest(once.ask, PRIYA, 'keen', FREE));
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(keenCount(twice.ask)).toBe(2);
  });

  it('lets a member change their answer before the threshold', () => {
    const keen = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', FREE));
    const not = unwrap(recordInterest(keen.ask, PRIYA, 'not_this_time', FREE));
    expect(not.changed).toBe(true);
    expect(keenCount(not.ask)).toBe(1);
  });

  it("does not count 'not this time' toward the threshold", () => {
    let ask = quietAsk();
    for (const id of [PRIYA, JESS, SAM, NIC, ALEX]) {
      ask = unwrap(recordInterest(ask, id, 'not_this_time', FREE)).ask;
    }
    expect(thresholdMet(ask)).toBe(false);
  });

  it("refuses to take the initiator's keen answer back; they withdraw instead", () => {
    const result = recordInterest(quietAsk(), TOM, 'not_this_time', FREE);
    expect(result).toEqual({ ok: false, error: { code: 'initiator_is_keen' } });
    expect(unwrap(recordInterest(quietAsk(), TOM, 'keen', FREE)).changed).toBe(false);
  });

  it('closes at the stop time, and once the ask has opened', () => {
    const atStop = recordInterest(quietAsk(), PRIYA, 'keen', { ...FREE, now: FRIDAY_MIDDAY });
    expect(atStop).toEqual({ ok: false, error: { code: 'interest_closed' } });
    const opened = quietAsk({ plan: quietPlan({ state: 'collecting' }) });
    expect(recordInterest(opened, PRIYA, 'keen', FREE)).toEqual({
      ok: false,
      error: { code: 'interest_closed' },
    });
  });

  it('holds an ask at its threshold beside an open plan, and says only "not yet"', () => {
    const held = { now: TOM_ASKS, circleHasOpenPlan: true };
    const one = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', held));
    const two = unwrap(recordInterest(one.ask, JESS, 'keen', held));
    expect(thresholdMet(two.ask)).toBe(true);
    expect(two.thresholdReached).toBe(false);
    // The answerer's result is the same shape and value as a below-threshold
    // one: nothing in it says the count is met.
    expect(Object.keys(two).sort()).toEqual(['ask', 'changed', 'thresholdReached']);
    expect(unwrap(recordInterest(quietAsk(), PRIYA, 'keen', held)).thresholdReached).toBe(false);
  });

  it('opens a held ask on the next answer after the open plan finishes, a repeat included', () => {
    const held = { now: TOM_ASKS, circleHasOpenPlan: true };
    const one = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', held));
    const two = unwrap(recordInterest(one.ask, JESS, 'keen', held));
    const again = unwrap(recordInterest(two.ask, JESS, 'keen', FREE));
    expect(again.changed).toBe(false);
    expect(again.thresholdReached).toBe(true);
  });

  it('treats an unknown open-plan fact as held', () => {
    const one = unwrap(recordInterest(quietAsk(), PRIYA, 'keen', { now: TOM_ASKS }));
    expect(unwrap(recordInterest(one.ask, JESS, 'keen', { now: TOM_ASKS })).thresholdReached).toBe(
      false,
    );
  });
});
