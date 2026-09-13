import { z } from 'zod';

import { PlanId, UserId } from '../ids.js';
import { Mutation } from './shared.js';

/** `accept-organiser` — Set the organiser on a quiet plan that has none. First writer wins. */
export const AcceptOrganiserRequest = Mutation.extend({
  plan_id: PlanId,
  role: z.enum(['initiator', 'volunteer', 'owner_fallback']),
});
export type AcceptOrganiserRequest = z.infer<typeof AcceptOrganiserRequest>;

export const AcceptOrganiserResponse = z.object({ organiser_member_id: UserId });
export type AcceptOrganiserResponse = z.infer<typeof AcceptOrganiserResponse>;
