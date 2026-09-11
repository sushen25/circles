import { isValidDisplayName } from '@circles/domain';
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
  /**
   * The domain's own rule, not a length of its own. `z.string().min(1).max(80)`
   * was both too lax and differently lax than `circle_members_name_length`,
   * which is on the *canonical* form: a name of 50 characters, or of nothing but
   * spaces, passed the schema and then tripped a check constraint the function
   * does not map — a 500 where the client should have been told to try another
   * name.
   */
  display_name: z.string().refine(isValidDisplayName, 'not a usable display name'),
});
export type RedeemInviteRequest = z.infer<typeof RedeemInviteRequest>;

export const RedeemInviteResponse = z.object({
  circle: CircleDto,
  /** The caller, who is now a member: `circle_members` is keyed by this. */
  member_user_id: UserId,
});
export type RedeemInviteResponse = z.infer<typeof RedeemInviteResponse>;
