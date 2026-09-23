import { z } from 'zod';

import { CircleId, UserId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `remove-member` — the owner takes somebody out of the circle (spec §5.2,
 * §4.5; S1-23).
 *
 * They lose access at once. Their answers to plans still asking are deleted,
 * they leave those plans' rosters, and each such plan is recalculated in the
 * same request so the options on screen no longer count them (ADR 0018).
 *
 * Reasons: `not_the_owner`; `cannot_remove_owner` for the owner themselves;
 * `member_not_found` for anybody not active in the circle, removed already
 * included.
 */
export const RemoveMemberRequest = Mutation.extend({
  circle_id: CircleId,
  user_id: UserId,
});
export type RemoveMemberRequest = z.infer<typeof RemoveMemberRequest>;

export const RemoveMemberResponse = z.object({
  ok: z.literal(true),
  /**
   * How many plans still asking lost this member's answers. Each was
   * recalculated in the request, or — if the engine could not run — has a
   * stale set that `confirm` refuses until it is.
   */
  affected_plans: z.int().min(0),
});
export type RemoveMemberResponse = z.infer<typeof RemoveMemberResponse>;
