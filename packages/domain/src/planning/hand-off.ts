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
  /**
   * One of the people this revision of the plan is asking. The organiser's
   * letters go to the people a plan was addressed to (`recipientsFor`'s
   * `organiser` audience), so somebody outside it would organise a plan that
   * could never write to them.
   */
  readonly isParticipant: boolean;
  /** Has a saved place: Apple, Google or an email code (ADR 0004). */
  readonly isPermanent: boolean;
};

export type HandOffRefusal =
  /** The plan is theirs already. */
  | 'already_the_organiser'
  /** Not in the circle, or not any more. */
  | 'not_a_member'
  /** In the circle, but not one of the people this plan asks (spec §9's opt-in). */
  | 'not_a_participant'
  /** "Organiser roles belong to saved-place identities only" (spec §8.2). */
  | 'requires_saved_place';

/** Why this person cannot take the plan over, or `undefined` when they can. */
export function handOffRefusal(
  target: HandOffTarget,
  organiserUserId: UserId | undefined,
): HandOffRefusal | undefined {
  if (target.userId === organiserUserId) return 'already_the_organiser';
  if (!target.isMember) return 'not_a_member';
  if (!target.isParticipant) return 'not_a_participant';
  if (!target.isPermanent) return 'requires_saved_place';
  return undefined;
}
