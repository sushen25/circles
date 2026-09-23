import { z } from 'zod';

import { CircleId } from '../ids.js';

/**
 * `get-invite-link` — the circle's invite secret again, for its owner (S1-23,
 * ADR 00XX).
 *
 * A read, so it carries no idempotency key and leaves no idempotency record:
 * the secret it answers with is not kept anywhere by asking for it.
 *
 * Owner only: anybody else gets `not_the_owner`, including a member, because
 * handing out the way in is the owner's alone (spec §5.2).
 */
export const GetInviteLinkRequest = z.object({ circle_id: CircleId });
export type GetInviteLinkRequest = z.infer<typeof GetInviteLinkRequest>;

export const GetInviteLinkResponse = z.object({
  /**
   * The secret for `${origin}/join#${secret}`, or `null` when the live link
   * cannot be shown again — it was made before links could be (or by a
   * deployment without the key), or the circle has none. The way to a link then
   * is `rotate-invite`, which the screen offers.
   */
  invite_secret: z.string().min(43).nullable(),
});
export type GetInviteLinkResponse = z.infer<typeof GetInviteLinkResponse>;
