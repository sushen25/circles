import { z } from 'zod';

import { CircleId } from '../ids.js';

/**
 * `get-invite-link` — the circle's invite secret again, for any active member
 * (S1-23, ADR 0028; widened from the owner alone by SUS-248).
 *
 * A read, so it carries no idempotency key and leaves no idempotency record:
 * the secret it answers with is not kept anywhere by asking for it.
 *
 * Any active member of the circle, guests included, so anyone can Add someone
 * between plans. Anybody else (removed, left, another circle's) gets
 * `not_a_member`. Making and cancelling invitations stay the owner's
 * (`rotate-invite`).
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
