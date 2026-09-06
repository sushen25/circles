import { z } from 'zod';

import { UserId } from '../ids.js';
import { Mutation } from './shared.js';

/** `claim-identity` — Link an anonymous identity’s memberships to a permanent one after sign-in. Idempotent. */
export const ClaimIdentityRequest = Mutation.extend({ anonymous_user_id: UserId });
export type ClaimIdentityRequest = z.infer<typeof ClaimIdentityRequest>;

export const ClaimIdentityResponse = z.object({
  user_id: UserId,
  merged_memberships: z.int().nonnegative(),
});
export type ClaimIdentityResponse = z.infer<typeof ClaimIdentityResponse>;
