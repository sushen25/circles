import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Instant } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `extend-deadline` — "Give it one more day" (spec §5.7).
 *
 * One day, from now or from the deadline if that is later, never past thirty
 * minutes before the last possible start, once per revision (`oneMoreDay` in
 * `packages/domain`). The server decides the new deadline and says what it
 * is; the caller does not propose one. `hours` is fixed at 24 so that a
 * request says what it asks for.
 *
 * Refusals: `not_the_organiser`, `already_extended`, `no_time_to_extend`,
 * `wrong_state` / `plan_is_finished`.
 */
export const ExtendDeadlineRequest = Mutation.extend({
  plan_id: PlanId,
  hours: z.literal(24).default(24),
});
export type ExtendDeadlineRequest = z.infer<typeof ExtendDeadlineRequest>;

export const ExtendDeadlineResponse = z.object({
  /** The deadline replies now close at. */
  response_deadline: Instant,
});
export type ExtendDeadlineResponse = z.infer<typeof ExtendDeadlineResponse>;
