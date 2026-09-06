import { z } from 'zod';

import { CircleId, PlanId, ContactId } from '../ids.js';
import { Mutation } from './shared.js';

/** `request-email-updates` — Normalise and dedupe the address, create a pending subscription, send the verification email. */
export const RequestEmailUpdatesRequest = Mutation.extend({
  plan_id: PlanId.optional(),
  circle_id: CircleId.optional(),
  email: z.email(),
});
export type RequestEmailUpdatesRequest = z.infer<typeof RequestEmailUpdatesRequest>;

export const RequestEmailUpdatesResponse = z.object({
  contact_id: ContactId,
  already_verified: z.boolean(),
});
export type RequestEmailUpdatesResponse = z.infer<typeof RequestEmailUpdatesResponse>;
