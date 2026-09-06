import { z } from 'zod';

import { PlanId, RevisionId, ResponseId } from '../ids.js';
import { Interval } from '../time.js';
import { Mutation } from './shared.js';

/** `submit-availability` — Replace the member’s response for the current revision and schedule recalculation. */
export const SubmitAvailabilityRequest = Mutation.extend({
  plan_id: PlanId,
  revision_id: RevisionId,
  status: z.enum(['windows', 'flexible', 'none_work']),
  windows: z.array(Interval).max(60),
});
export type SubmitAvailabilityRequest = z.infer<typeof SubmitAvailabilityRequest>;

export const SubmitAvailabilityResponse = z.object({
  response_id: ResponseId,
  input_version: z.int().nonnegative(),
});
export type SubmitAvailabilityResponse = z.infer<typeof SubmitAvailabilityResponse>;
