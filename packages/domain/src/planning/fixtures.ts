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
      scoringVersion: 1,
      shortCode: 'abc123',
    },
    overrides,
  );
}
