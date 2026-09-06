import { z } from 'zod';

import { CircleId, MemberId } from '../ids.js';
import { Mutation } from './shared.js';

/** `redeem-invite` — Verify Turnstile, hash the fragment secret, check the invite is live, create the membership. */
export const RedeemInviteRequest = Mutation.extend({
  secret: z.string().min(16),
  turnstile_token: z.string().optional(),
  display_name: z.string().min(1).max(80).optional(),
});
export type RedeemInviteRequest = z.infer<typeof RedeemInviteRequest>;

export const RedeemInviteResponse = z.object({ circle_id: CircleId, member_id: MemberId });
export type RedeemInviteResponse = z.infer<typeof RedeemInviteResponse>;
