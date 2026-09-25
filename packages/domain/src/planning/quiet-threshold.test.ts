import { describe, expect, it } from 'vitest';

import { ALEX, JESS, PRIYA, TOM } from '../scheduling/fixtures.js';
import { addMinutes } from '../shared/instant.js';
import { lastPossibleStart } from './deadline.js';
import { FRIDAY_MIDDAY, TOM_ASKS, quietAsk, quietPlan } from './fixtures.js';
import { NOBODY, nextQuietStep, onThreshold } from './quiet-threshold.js';
import { canTransition } from './state-machine.js';

const DAY = 24 * 60;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('nextQuietStep', () => {
  const met = quietAsk({
    answers: [
      [TOM, 'keen'],
      [PRIYA, 'keen'],
      [JESS, 'keen'],
    ],
  });

  it('crosses a met ask once the circle is free, waits while it is not', () => {
    expect(nextQuietStep(met, TOM_ASKS, false)).toBe('cross');
    expect(nextQuietStep(met, TOM_ASKS, true)).toBe('wait');
    expect(nextQuietStep(met, TOM_ASKS)).toBe('wait');
  });

  it('waits below the threshold, and expires any seeking ask from its stop time', () => {
    expect(nextQuietStep(quietAsk(), TOM_ASKS, false)).toBe('wait');
    expect(nextQuietStep(quietAsk(), FRIDAY_MIDDAY, false)).toBe('expire');
    expect(nextQuietStep(met, FRIDAY_MIDDAY, false)).toBe('expire');
  });

  it('has nothing to do with a plan that is not seeking', () => {
    expect(nextQuietStep(quietAsk({ plan: quietPlan({ state: 'collecting' }) }), TOM_ASKS)).toBe(
      'none',
    );
  });
});

describe('onThreshold', () => {
  const met = quietAsk({
    answers: [
      [TOM, 'keen'],
      [PRIYA, 'keen'],
      [ALEX, 'not_this_time'],
      [JESS, 'keen'],
    ],
  });
  const wednesday = addMinutes(TOM_ASKS, DAY);

  it('opens into collecting with no organiser and a deadline defaulted from now', () => {
    const { plan, initialResponders } = unwrap(
      onThreshold(met, { preset: 'this_weekend', now: wednesday, circleHasOpenPlan: false }),
    );
    expect(plan.state).toBe('collecting');
    expect(plan.organiserUserId).toBeUndefined();
    // This weekend: twenty-four hours from the moment it opened, not from when it was asked.
    expect(plan.responseDeadline).toBe(addMinutes(wednesday, DAY));
    expect(plan.responseDeadline).toBeLessThanOrEqual(lastPossibleStart(plan));
    expect([...initialResponders].sort()).toEqual([JESS, PRIYA, TOM].sort());
  });

  it('refuses below the threshold', () => {
    const result = onThreshold(quietAsk(), {
      preset: 'this_weekend',
      now: wednesday,
      circleHasOpenPlan: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('threshold_not_reached');
  });

  it('refuses beside an open plan, and when that is not known', () => {
    for (const circleHasOpenPlan of [true, undefined]) {
      expect(
        onThreshold(met, { preset: 'this_weekend', now: wednesday, circleHasOpenPlan }),
      ).toEqual({ ok: false, error: { code: 'plan_in_progress' } });
    }
  });

  it('is held by the table too: threshold_reached beside an open plan is refused there', () => {
    // The authority, called directly, the way `transition_plan` mirrors it.
    for (const circleHasOpenPlan of [true, undefined]) {
      const direct = canTransition(met.plan, 'threshold_reached', {
        actor: NOBODY,
        keenCount: 3,
        circleHasOpenPlan,
      });
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(direct.error.code).toBe('plan_in_progress');
    }
    const free = canTransition(met.plan, 'threshold_reached', {
      actor: NOBODY,
      keenCount: 3,
      circleHasOpenPlan: false,
    });
    expect(free.ok).toBe(true);
  });

  it('refuses from its stop time: from then on it can only expire', () => {
    expect(
      onThreshold(met, { preset: 'this_weekend', now: FRIDAY_MIDDAY, circleHasOpenPlan: false }),
    ).toEqual({ ok: false, error: { code: 'interest_closed' } });
  });

  it('refuses a named plan', () => {
    const named = quietAsk({ plan: quietPlan({ mode: 'named' }) });
    expect(
      onThreshold(named, { preset: 'this_weekend', now: wednesday, circleHasOpenPlan: false }),
    ).toEqual({ ok: false, error: { code: 'not_quiet' } });
  });
});
