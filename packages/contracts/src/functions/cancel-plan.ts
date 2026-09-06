import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation, Accepted } from './shared.js';

/** `cancel-plan` — Final state with an optional note key. Enqueues cancellation notices. */
export const CancelPlanRequest = Mutation.extend({
  plan_id: PlanId,
  reason_key: z.string().optional(),
});
export type CancelPlanRequest = z.infer<typeof CancelPlanRequest>;

export const CancelPlanResponse = Accepted;
export type CancelPlanResponse = z.infer<typeof CancelPlanResponse>;
