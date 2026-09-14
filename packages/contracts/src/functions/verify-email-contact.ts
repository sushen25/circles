import { z } from 'zod';

import { OpaqueToken, PlanId } from '../ids.js';

/**
 * `verify-email-contact` — the link in the verification email (spec §5.8).
 *
 * No sign-in and no session: the token *is* the authorisation. It is single-use
 * and expires in 24 hours, and the one before it was invalidated when this one
 * was issued, so a person who asked twice can only use the newest.
 *
 * `/v/:token` is a client route; the screen posts the token here rather than the
 * link being the endpoint, so that what a mail scanner prefetches is a page and
 * not a consumption. A token spent by an antivirus proxy is a person told their
 * link has already been used.
 */
export const VerifyEmailContactRequest = z.object({ token: OpaqueToken });
export type VerifyEmailContactRequest = z.infer<typeof VerifyEmailContactRequest>;

export const VerifyEmailContactResponse = z.object({
  /**
   * The plans this address will now hear about. Usually one — the plan the
   * person asked from — and never one that has finished: "verification after
   * the plan completed or was cancelled: no stale mail is sent" (spec §9), so a
   * subscription to a plan that is over stays inactive and is not listed.
   */
  active_plan_ids: z.array(PlanId),
  /**
   * Whether the meetup is already locked in, so the screen can say what was
   * missed rather than "you will hear about the next change". One `locked_in`
   * email is enqueued in that case, which is the current state sent once.
   */
  already_confirmed: z.boolean(),
});
export type VerifyEmailContactResponse = z.infer<typeof VerifyEmailContactResponse>;
