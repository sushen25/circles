import { z } from 'zod';

import { CircleId } from '../ids.js';
import { JoinDisplayName } from './redeem-invite.js';
import { Mutation } from './shared.js';

/**
 * `rename-in-circle` — a member changes the name one circle calls them,
 * without leaving and rejoining (SUS-205, ADR 0070).
 *
 * The caller's own active membership in that one circle, and nothing else: no
 * account name, no other circle, no plan. There is no field naming another
 * person, so the owner cannot rename anybody. The name is judged by the same
 * schema as the join screen's (`JoinDisplayName`), so the two cannot disagree.
 *
 * Reasons: `duplicate_name` (somebody active in the circle already has it),
 * `display_name_unusable`, `member_not_found` for a caller who is not active in
 * the circle (the three ways of not being one are not told apart),
 * `too_many_requests`.
 */
export const RenameInCircleRequest = Mutation.extend({
  circle_id: CircleId,
  display_name: JoinDisplayName,
});
export type RenameInCircleRequest = z.infer<typeof RenameInCircleRequest>;

export const RenameInCircleResponse = z.object({ ok: z.literal(true) });
export type RenameInCircleResponse = z.infer<typeof RenameInCircleResponse>;
