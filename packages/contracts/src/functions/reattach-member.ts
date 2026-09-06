import { z } from 'zod';

import { CircleId, MemberId, OpaqueToken } from '../ids.js';
import { Mutation } from './shared.js';

/** `reattach-member` — Move a membership to the caller’s new anonymous identity, chosen from the Continue-as list or authorised by an emailed token. */
export const ReattachMemberRequest = Mutation.extend({
  circle_id: CircleId,
  target_member_id: MemberId.optional(),
  reentry_token: OpaqueToken.optional(),
});
export type ReattachMemberRequest = z.infer<typeof ReattachMemberRequest>;

export const ReattachMemberResponse = z.object({ member_id: MemberId });
export type ReattachMemberResponse = z.infer<typeof ReattachMemberResponse>;
