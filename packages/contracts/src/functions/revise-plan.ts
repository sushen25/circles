import { z } from 'zod';

import { PlanId, RevisionId } from '../ids.js';
import { Instant, Interval, DurationMinutes } from '../time.js';
import { Mutation } from './shared.js';

/** `revise-plan` — Edit window, duration, quorum or deadline. Creates a revision and invalidates responses. */
export const RevisePlanRequest = Mutation.extend({
  plan_id: PlanId,
  window: Interval.optional(),
  duration_minutes: DurationMinutes.optional(),
  response_deadline: Instant.optional(),
  quorum: z.int().positive().optional(),
});
export type RevisePlanRequest = z.infer<typeof RevisePlanRequest>;

export const RevisePlanResponse = z.object({
  revision_id: RevisionId,
  invalidated_responses: z.int().nonnegative(),
});
export type RevisePlanResponse = z.infer<typeof RevisePlanResponse>;
