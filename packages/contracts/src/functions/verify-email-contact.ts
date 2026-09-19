import { z } from 'zod';

import { OpaqueToken, PlanId, ShortCode } from '../ids.js';

/**
 * `verify-email-contact` — the link in the verification email (spec §5.8).
 *
 * No sign-in and no session: the token *is* the authorisation. It is single-use
 * and expires in 24 hours, and the one before it was invalidated when this one
 * was issued, so a person who asked twice can only use the newest.
 *
 * `/v#<token>` is a client route; the screen posts the token here rather than the
 * link being the endpoint, so that what a mail scanner prefetches is a page and
 * not a consumption. A token spent by an antivirus proxy is a person told their
 * link has already been used.
 */
export const VerifyEmailContactRequest = z.object({ token: OpaqueToken });
export type VerifyEmailContactRequest = z.infer<typeof VerifyEmailContactRequest>;

export const VerifyEmailContactResponse = z.object({
  /**
   * The plans this address will now hear about, **named**.
   *
   * This page is opened wherever the mail was read, so the browser usually
   * holds no session and often a brand-new anonymous one — and a plan is
   * readable only by a member of its circle. Ids alone therefore left the
   * screen with nothing to put on the button and nowhere to send it: `/p/`
   * takes a short code, not an id. `manage-email-preferences` returns the same
   * two facts for the same reason, and they are safe for the same reason —
   * whoever holds this token proved control of the address, and the email that
   * carried it named the plan and the circle to this reader already.
   *
   * Never one that has finished: "verification after the plan completed or was
   * cancelled: no stale mail is sent" (spec §9), so a subscription to a plan
   * that is over is withdrawn by the click and is not listed. Never another
   * identity's, either — one click verifies every contact holding the address,
   * but the answer goes to one browser held by one person.
   */
  active_plans: z.array(
    z.object({
      plan_id: PlanId,
      /** For the link back: `/p/<code>` is the plan page (architecture §5). */
      short_code: ShortCode,
      plan_title: z.string(),
      circle_name: z.string(),
    }),
  ),
  /**
   * Whether the meetup is already locked in, so the screen can say what was
   * missed rather than "you will hear about the next change". One `locked_in`
   * email is enqueued in that case, which is the current state sent once.
   */
  already_confirmed: z.boolean(),
});
export type VerifyEmailContactResponse = z.infer<typeof VerifyEmailContactResponse>;
