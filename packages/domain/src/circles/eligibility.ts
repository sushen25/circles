/**
 * Who may organise, and where (ADR 0004, spec §5.1 and §8.2).
 *
 * Two rules, and they are not the same rule:
 *
 * - **Starting a circle** needs a saved place and nothing else. There is no
 *   circle to belong to yet.
 * - **Organising inside a circle** — a new plan, an edit, a cancellation —
 *   needs a saved place *and* active membership of that circle. §8.2 gates
 *   everything about a circle on being an active member of it, and organising
 *   is the loudest thing anybody does in one.
 *
 * Here rather than in the client because non-negotiable 2 says so: "if a screen
 * needs to know whether something is allowed, the answer comes from
 * `packages/domain`". The client had its own copy, which is a second statement
 * of a rule that can drift from this one and from the database — and the way it
 * drifts is that somebody is sent to the wrong screen and told no by a server
 * after filling a form in.
 *
 * The client's answer is never the authority in any case: `create-circle` and
 * `create-plan` refuse an ineligible caller, and RLS refuses a non-member. This
 * exists so the person sees the right screen rather than an error.
 */

/** Only what the decision turns on. A session or a row can satisfy it. */
export interface OrganiserActor {
  /** A saved place: an identity that can be found again on another device. */
  readonly isPermanent: boolean;
  /** An *active* member of the circle in question. An id on a row is not membership. */
  readonly isMember: boolean;
}

/**
 * Why somebody may not organise, or that they may.
 *
 * A reason rather than a boolean, because the two refusals lead to different
 * screens: one offers to save your place, the other offers a way into the
 * circle. Collapsing them would make the client guess.
 */
export type OrganiserEligibility = 'allowed' | 'needs_saved_place' | 'needs_membership';

/** Starting a brand-new circle. No circle, so no membership to have. */
export function mayStartCircle(actor: Pick<OrganiserActor, 'isPermanent'>): OrganiserEligibility {
  return actor.isPermanent ? 'allowed' : 'needs_saved_place';
}

/**
 * Organising inside a circle that already exists.
 *
 * The saved place is checked first, deliberately. Somebody who is neither is
 * told the thing they can act on — sign-in is a step they can take, whereas
 * "you are not in this circle" is a dead end when they have no identity to be
 * in it with.
 */
export function mayOrganiseInCircle(actor: OrganiserActor): OrganiserEligibility {
  if (!actor.isPermanent) return 'needs_saved_place';
  return actor.isMember ? 'allowed' : 'needs_membership';
}

/**
 * Who may take somebody out of a circle (spec §5.2): its owner, and never the
 * owner themselves — a circle is owned by one of its members. The screen asks
 * this to decide whether to offer "Remove"; `remove_member` asks the same
 * question of the rows and is the authority.
 */
export function mayRemoveMember(input: {
  readonly viewerIsOwner: boolean;
  readonly targetIsOwner: boolean;
}): boolean {
  return input.viewerIsOwner && !input.targetIsOwner;
}

/**
 * The owner's decisions about a circle — its link, its rhythm, its colour,
 * archiving it (spec §5.2). Members change only their own switches.
 */
export function mayManageCircle(input: { readonly viewerIsOwner: boolean }): boolean {
  return input.viewerIsOwner;
}
