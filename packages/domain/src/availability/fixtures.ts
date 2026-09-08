/**
 * Builders for the availability context. Replaces the `response` placeholder
 * from `shared/fixtures.ts`, per the convention S1-01 set.
 */

import { userId } from '../circles/types.js';
import { planId } from '../planning/types.js';
import { type Overrides, build } from '../shared/build.js';
import { fromISO } from '../shared/instant.js';
import type { Response } from './types.js';

export function response(overrides: Overrides<Response> = {}): Response {
  return build<Response>(
    {
      planId: planId('plan-1'),
      revision: 1,
      userId: userId('user-1'),
      status: 'windows',
      windows: [],
      usedCalendarOverlay: false,
      submittedAt: fromISO('2026-09-15T08:00:00Z'),
    },
    overrides,
  );
}
