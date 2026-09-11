import { z } from 'zod';

import { UserId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `claim-identity` — reconcile a guest's memberships after they save their place
 * (§10), called straight after `linkIdentity` or `signInWithIdToken`.
 *
 * `anonymous_session` is the **access token of the session that has just been
 * replaced**, not its user id. That is the whole security design of this
 * endpoint: the claim being made is "I was also that anonymous user", and a user
 * id is not proof of anything, while a token that still verifies is. The
 * function reads the id out of it and never trusts a caller-supplied one.
 *
 * Reasons it can refuse: `source_is_permanent`.
 */
export const ClaimIdentityRequest = Mutation.extend({
  anonymous_session: z.string().min(1).max(4096),
  /** Where in the journey this happened — the funnel is measured by it. */
  moment: z.enum(['after_answer', 'after_confirmed', 'after_attendance', 'settings']),
});
export type ClaimIdentityRequest = z.infer<typeof ClaimIdentityRequest>;

export const ClaimIdentityResponse = z.object({
  user_id: UserId,
  /** How many memberships moved across. Zero is the ordinary answer. */
  merged_memberships: z.int().nonnegative(),
});
export type ClaimIdentityResponse = z.infer<typeof ClaimIdentityResponse>;
