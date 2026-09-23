import { z } from 'zod';

import { CircleId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `rotate-invite` — "Reset link" in circle settings (spec §5.2, S1-23).
 *
 * Revokes the live link and issues a new one in the same statement, so the old
 * one stops working at once (redeeming it answers `invite_inactive`) while
 * everybody already in stays in. The owner's alone: `not_the_owner` otherwise.
 *
 * Idempotent on the key like every mutation: a retry after a lost response
 * returns the same new link rather than rotating a second time and killing the
 * one the first attempt made.
 */
export const RotateInviteRequest = Mutation.extend({ circle_id: CircleId });
export type RotateInviteRequest = z.infer<typeof RotateInviteRequest>;

export const RotateInviteResponse = z.object({
  /** The new secret, for `${origin}/join#${secret}`. Only its digest is stored. */
  invite_secret: z.string().min(43),
});
export type RotateInviteResponse = z.infer<typeof RotateInviteResponse>;
