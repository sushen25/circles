import { z } from 'zod';

import { CircleId, PlanId, ShortCode } from '../ids.js';
import { Instant, Interval, DurationMinutes } from '../time.js';
import { Mutation } from './shared.js';

/** `create-plan` — Named or quiet. Applies the circle’s defaults, validates window and deadline, enqueues notifications. */
export const CreatePlanRequest = Mutation.extend({
  circle_id: CircleId,
  mode: z.enum(['named', 'quiet']),
  title_key: z.string().optional(),
  window: Interval,
  duration_minutes: DurationMinutes,
  response_deadline: Instant,
  quorum: z.int().positive().optional(),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

export const CreatePlanResponse = z.object({ plan_id: PlanId, short_code: ShortCode });
export type CreatePlanResponse = z.infer<typeof CreatePlanResponse>;
