/**
 * "Hand this to someone else" (spec §5.7, §9: "the organiser wants out").
 *
 * Who a plan may be handed to. The `hand_off` transition's own guard is
 * `organiser` — only the person organising can give it away — and this is the
 * other half, about the person receiving it. `planning.transition_plan` holds
 * the same rule as its `hand_off_target` guard; this copy is the one a screen
 * asks, so a guest can be shown greyed out rather than refused after a tap.
 */

import type { UserId } from '../circles/types.js';

export type HandOffTarget = {
  readonly userId: UserId;
  /** An active member of the plan's circle, now. */
  readonly isMember: boolean;
  /** Has a saved place: Apple, Google or an email code (ADR 0004). */
  readonly isPermanent: boolean;
};

export type HandOffRefusal =
  /** The plan is theirs already. */
  | 'already_the_organiser'
  /** Not in the circle, or not any more. */
  | 'not_a_member'
  /** "Organiser roles belong to saved-place identities only" (spec §8.2). */
  | 'requires_saved_place';

/** Why this person cannot take the plan over, or `undefined` when they can. */
export function handOffRefusal(
  target: HandOffTarget,
  organiserUserId: UserId | undefined,
): HandOffRefusal | undefined {
  if (target.userId === organiserUserId) return 'already_the_organiser';
  if (!target.isMember) return 'not_a_member';
  if (!target.isPermanent) return 'requires_saved_place';
  return undefined;
}
