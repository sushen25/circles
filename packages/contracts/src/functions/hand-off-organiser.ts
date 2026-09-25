import type { z } from 'zod';

import { PlanId, UserId } from '../ids.js';
import { Accepted, Mutation } from './shared.js';

/**
 * `hand-off-organiser` — "Hand this to someone else" (spec §5.7, §9).
 *
 * The organiser gives the plan to another active member the plan is asking,
 * with a saved place. Refusals: `not_the_organiser`, `requires_saved_place` (a
 * guest), `not_a_member` (not in the circle, or not any more),
 * `not_a_participant` (in the circle, never asked), `already_the_organiser`,
 * and `wrong_state` / `plan_is_finished` once there is nothing to decide.
 */
export const HandOffOrganiserRequest = Mutation.extend({
  plan_id: PlanId,
  to_user_id: UserId,
});
export type HandOffOrganiserRequest = z.infer<typeof HandOffOrganiserRequest>;

export const HandOffOrganiserResponse = Accepted;
export type HandOffOrganiserResponse = z.infer<typeof HandOffOrganiserResponse>;
