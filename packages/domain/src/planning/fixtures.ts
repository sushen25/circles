/**
 * Builders for the plan context. Replaces the `plan` placeholder that lived in
 * `shared/fixtures.ts`, per the convention S1-01 set: a context owns its own
 * builders and `src/fixtures.ts` aggregates them.
 */

import { circleId, userId } from '../circles/types.js';
import { build, type Overrides } from '../shared/build.js';
import { fromISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { type Instant, addMinutes } from '../shared/instant.js';
import { fromLocal } from '../shared/zone.js';
import { TOM } from '../scheduling/fixtures.js';
import type { UserId } from '../circles/types.js';
import type { Interest, QuietAsk } from './quiet.js';
import { type Plan, planId } from './types.js';

/** Thursday 17 September 2026 — the canvas's example week. */
export const A_WINDOW = { start: localDate('2026-09-14'), end: localDate('2026-09-20') };

export function plan(overrides: Overrides<Plan> = {}): Plan {
  return build<Plan>(
    {
      id: planId('plan-1'),
      circleId: circleId('circle-1'),
      mode: 'named',
      state: 'collecting',
      organiserUserId: userId('user-owner'),
      title: 'Catch up',
      category: 'catch_up',
      zone: MELBOURNE,
      window: A_WINDOW,
      daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
      durationMinutes: 120,
      quorum: 4,
      requiredMemberIds: [userId('user-owner')],
      responseDeadline: fromISO('2026-09-15T08:00:00Z'),
      revision: 1,
      inputVersion: 1,
      scoringVersion: 1,
      shortCode: 'abc123',
    },
    overrides,
  );
}

/**
 * Tuesday 15 September 2026, 10 am Melbourne: Tom asks quietly whether
 * anyone is keen this weekend, and stops asking Friday midday (spec §6.3).
 */
export const TOM_ASKS: Instant = fromLocal(localDate('2026-09-15'), 10 * 60, MELBOURNE);

export const THIS_WEEKEND = { start: localDate('2026-09-19'), end: localDate('2026-09-20') };

/** Friday 18 September, 12 pm Melbourne. */
export const FRIDAY_MIDDAY: Instant = fromLocal(localDate('2026-09-18'), 12 * 60, MELBOURNE);

/** Tom's ask, still seeking: the weekend, 9 am–10:30 pm, threshold three. */
export function quietPlan(overrides: Overrides<Plan> = {}): Plan {
  return plan({
    id: planId('plan-quiet'),
    mode: 'quiet',
    state: 'seeking',
    organiserUserId: undefined,
    window: THIS_WEEKEND,
    daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
    quietThreshold: 3,
    quietExpiresAt: FRIDAY_MIDDAY,
    responseDeadline: addMinutes(TOM_ASKS, 24 * 60),
    requiredMemberIds: [],
    ...overrides,
  });
}

/** Tom's ask with its private half: Tom started it, and Tom is keen. */
export function quietAsk(
  overrides: {
    readonly plan?: Plan;
    readonly initiatorId?: UserId;
    readonly answers?: readonly (readonly [UserId, Interest])[];
  } = {},
): QuietAsk {
  const initiatorId = overrides.initiatorId ?? TOM;
  return {
    plan: overrides.plan ?? quietPlan(),
    initiatorId,
    answers: new Map(overrides.answers ?? [[initiatorId, 'keen']]),
  };
}
