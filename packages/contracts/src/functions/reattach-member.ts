import { z } from 'zod';

import { CircleDto } from '../dtos.js';
import { CircleId, OpaqueToken, UserId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `reattach-member` — move a guest membership onto the calling anonymous
 * identity (ADR 0006).
 *
 * Two ways in, and exactly one of them per request: the membership picked from
 * the Continue-as list, or a re-entry token from a plan-update email. Sending
 * both, or neither, is an `invalid_request` — a request that could be read two
 * ways is a request the server should not guess at.
 *
 * Reasons it can refuse: `member_not_found`, `target_is_permanent`,
 * `caller_is_permanent`, `already_member`, `reattach_limit`, `token_invalid`.
 */
export const ReattachMemberRequest = Mutation.extend({
  circle_id: CircleId.optional(),
  /** From `guest_members_for_reattach`: the identity that holds the membership. */
  target_member_user_id: UserId.optional(),
  /** From an emailed `/a/:token` link. Single-use, seven days. Never logged. */
  reentry_token: OpaqueToken.optional(),
})
  .refine(
    (body) => (body.reentry_token === undefined) !== (body.target_member_user_id === undefined),
    { message: 'send either a target membership or a re-entry token' },
  )
  .refine((body) => body.reentry_token !== undefined || body.circle_id !== undefined, {
    message: 'a target membership needs the circle it is in',
  });
export type ReattachMemberRequest = z.infer<typeof ReattachMemberRequest>;

export const ReattachMemberResponse = z.object({
  circle: CircleDto,
  /** The caller's id: the membership is theirs now. */
  member_user_id: UserId,
});
export type ReattachMemberResponse = z.infer<typeof ReattachMemberResponse>;
