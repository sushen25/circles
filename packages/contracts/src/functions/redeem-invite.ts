import { z } from 'zod';

import { CircleDto } from '../dtos.js';
import { UserId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `redeem-invite` — join the circle behind an invite link.
 *
 * The `secret` is the link's **fragment**, which is why it never appears in a
 * URL the server sees (§14). The function hashes it and sends only the digest to
 * the database, so the capability is not a query parameter anywhere.
 *
 * Reasons it can refuse: `invite_inactive` (the LinkInvalid screen),
 * `circle_full`, `duplicate_name` (ask for another name, spec §9).
 */
export const RedeemInviteRequest = Mutation.extend({
  /** ≥256 bits, base64url in the link fragment. Never logged. */
  secret: z.string().min(32).max(256),
  /** Required on web, where Turnstile guards anonymous joins; absent on native. */
  turnstile_token: z.string().max(4096).optional(),
  display_name: z.string().min(1).max(80),
});
export type RedeemInviteRequest = z.infer<typeof RedeemInviteRequest>;

export const RedeemInviteResponse = z.object({
  circle: CircleDto,
  /** The caller, who is now a member: `circle_members` is keyed by this. */
  member_user_id: UserId,
});
export type RedeemInviteResponse = z.infer<typeof RedeemInviteResponse>;
