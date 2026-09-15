import { z } from 'zod';

import { OpaqueToken, PlanId } from '../ids.js';

/**
 * `manage-email-preferences` — stopping email without signing in (spec §5.8).
 *
 * Every event email carries this link, and it has to work for somebody who has
 * no account, is reading on a borrowed phone, or has forgotten the circle
 * exists. That is the Spam Act's "unsubscribe in five working days" answered in
 * one tap, and it is why the token is long-lived where the verification one is
 * not: a link in an email from three months ago still has to stop the emails.
 */
export const ManageEmailPreferencesRequest = z
  .object({
    token: OpaqueToken,
    /**
     * `view` shows what this address is subscribed to; `stop_plan` ends one
     * subscription; `remove_contact` ends all of them and marks the address
     * removed, after which retention purges it.
     *
     * Named rather than a boolean, because "disable" could not say which of the
     * three it meant — and the difference between stopping one meetup's email and
     * asking to be forgotten is not a flag.
     */
    action: z.enum(['view', 'stop_plan', 'remove_contact']),
    /** Required by `stop_plan` and meaningless to the others. */
    plan_id: PlanId.optional(),
  })
  .refine((body) => (body.action === 'stop_plan') === (body.plan_id !== undefined), {
    message: 'a plan to stop, and only for stop_plan',
    path: ['plan_id'],
  });
export type ManageEmailPreferencesRequest = z.infer<typeof ManageEmailPreferencesRequest>;

export const ManageEmailPreferencesResponse = z.object({
  /**
   * What this address hears about, by plan. The circle's name and the plan's
   * title are here because the page is unauthenticated and otherwise unreadable
   * — "stop emails about b4f1…" is not a choice anybody can make — and they are
   * the same two things the email's own subject already carried to this reader.
   * No member names, no addresses, no quiet-ask state (§5.8).
   */
  subscriptions: z.array(
    z.object({
      plan_id: PlanId,
      plan_title: z.string(),
      circle_name: z.string(),
      active: z.boolean(),
    }),
  ),
  /** True once `remove_contact` has run: the screen stops offering the list. */
  removed: z.boolean(),
});
export type ManageEmailPreferencesResponse = z.infer<typeof ManageEmailPreferencesResponse>;
