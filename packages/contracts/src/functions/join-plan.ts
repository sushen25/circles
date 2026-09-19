import { z } from 'zod';

import { CircleDto } from '../dtos.js';
import { ShortCode, UserId } from '../ids.js';
import { JoinDisplayName } from './redeem-invite.js';
import { Mutation } from './shared.js';

/**
 * `join-plan` — join a circle from a plan's link, as somebody that plan is
 * asking (ADR 0022).
 *
 * A plan's short code admits new members while the plan is taking answers. The
 * same call serves a member the plan never asked: it adds them to the plan and
 * nothing else. Calling it again changes nothing.
 *
 * `display_name` is required for a guest who is not yet a member. A saved place
 * may leave it out and joins under their profile's name; after a
 * `duplicate_name` they send one, which names the membership in this circle and
 * leaves the profile alone. A member's name is never read.
 *
 * Reasons it can refuse: `invite_inactive` — for **every** plan that is not
 * admitting and for a code that does not exist, one answer, so a refusal says
 * nothing about which — and, from a plan that is admitting, `duplicate_name`,
 * `display_name_unusable` and `circle_full`.
 */
export const JoinPlanRequest = Mutation.extend({
  /**
   * From `/j/<code>` or `/p/<code>`. Not a secret — it is pasted into chats —
   * but it admits people now, so it is kept out of function logs and analytics
   * all the same (ADR 0022).
   */
  plan_code: ShortCode,
  display_name: JoinDisplayName.optional(),
  /** Required on web, where Turnstile guards anonymous joins; absent on native. */
  turnstile_token: z.string().max(4096).optional(),
});
export type JoinPlanRequest = z.infer<typeof JoinPlanRequest>;

export const JoinPlanResponse = z.object({
  circle: CircleDto,
  /** The caller, who is now a member and a participant of the plan. */
  member_user_id: UserId,
  /** The plan they joined through, so the client can go straight to it. */
  plan_code: ShortCode,
});
export type JoinPlanResponse = z.infer<typeof JoinPlanResponse>;
