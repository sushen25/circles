import { mayOrganiseInCircle, mayStartCircle } from '@circles/domain';

import type { SessionState } from './session';

/**
 * What a route should do about who is here (architecture §10, §11; ADR 0004).
 *
 * A pure function over the session and one server-answered fact, returning a
 * decision rather than performing a navigation. Non-negotiable 2: a screen
 * never decides whether something is allowed.
 *
 * **And neither does this.** Whether somebody may organise is a product rule,
 * so it lives in `packages/domain` (`mayStartCircle`, `mayOrganiseInCircle`)
 * and this file asks it. What is left here is the mapping from that answer to a
 * screen, plus the two things the domain has no opinion about: whether the
 * session has finished loading, and whether we have heard back about
 * membership yet. A second copy of the rule here would be one that can drift
 * from the domain's and the database's, and the way it drifts is that somebody
 * is sent to the wrong screen.
 *
 * The client's answer is never the authority. `create-circle` and `create-plan`
 * refuse an anonymous caller with `requires_saved_place` whatever this returns,
 * and RLS refuses a non-member. This exists so the person sees the right screen
 * rather than an error, and for no other reason.
 */

/**
 * What a route needs.
 *
 * - `public`    — Welcome, privacy, the link-preview route. Anyone, including nobody.
 * - `guest`     — a circle or plan route. Needs *a* session and a membership.
 * - `saved`     — needs a saved place and nothing else: starting a *new* circle,
 *                 account and privacy settings. There is no circle to belong to
 *                 yet (ADR 0004).
 * - `organiser` — organising inside an existing circle: a new plan, an edit, a
 *                 cancellation. Needs a saved place **and** membership of that
 *                 circle. Spec §5.1 gates organising on a saved place; §8.2
 *                 gates everything about a circle on being an active member of
 *                 it, and this route is both at once.
 */
export type RouteKind = 'public' | 'guest' | 'saved' | 'organiser';

/**
 * Whether the caller belongs to the circle this route is about.
 *
 * Deliberately an input rather than something fetched here: it is a server
 * answer, it is per-route, and a guard that fetched would make every navigation
 * wait on a round trip. `unknown` is the honest value while it is in flight.
 */
export type Membership = 'member' | 'not_member' | 'unknown';

export interface GuardInput {
  route: RouteKind;
  session: SessionState;
  /** Only meaningful for `guest` routes; ignored elsewhere. */
  membership?: Membership;
}

export type GuardDecision =
  /** Render the route. */
  | { kind: 'allow' }
  /** Nothing is known yet. Render the loading state, navigate nowhere. */
  | { kind: 'wait' }
  /**
   * No session at all on a route that needs one. The client signs in
   * anonymously *first* and then asks who is in the circle — §10 is explicit
   * that the session comes first, because `guest_members_for_reattach` is
   * granted to `authenticated` and not to `anon`.
   */
  | { kind: 'needs_session' }
  /** A session that holds no membership here: offer Continue-as, or "I'm new here". */
  | { kind: 'continue_as' }
  /** A guest trying to organise. The InitiateGate (ADR 0004, spec §5.1). */
  | { kind: 'needs_saved_place' };

export function guard({ route, session, membership = 'unknown' }: GuardInput): GuardDecision {
  // Before anything else. A guard that answers from an unread session sends a
  // signed-in member to Continue-as on first render, which looks exactly like
  // having been signed out and is the single most alarming way to get this
  // wrong.
  if (session.isLoading) return { kind: 'wait' };

  if (route === 'public') return { kind: 'allow' };

  const isPermanent = session.status !== 'none' && session.status !== 'guest';

  if (route === 'saved') {
    // Guests and strangers get the same screen, because they need the same
    // thing. It is worded as a practical need — "so we can find you again on
    // any device" — not as a wall (§5.1).
    return mayStartCircle({ isPermanent }) === 'allowed'
      ? { kind: 'allow' }
      : { kind: 'needs_saved_place' };
  }

  if (route === 'organiser') {
    // Membership is the one input the domain cannot supply for itself, and
    // "not heard back yet" is not an answer to give it: `isMember: false` while
    // a lookup is in flight would refuse a member on their first frame.
    if (isPermanent && membership === 'unknown') return { kind: 'wait' };

    switch (mayOrganiseInCircle({ isPermanent, isMember: membership === 'member' })) {
      case 'allowed':
        return { kind: 'allow' };
      case 'needs_saved_place':
        return { kind: 'needs_saved_place' };
      case 'needs_membership':
        return { kind: 'continue_as' };
    }
  }

  // A `guest` route from here: a circle or a plan.
  if (session.status === 'none') return { kind: 'needs_session' };

  switch (membership) {
    case 'member':
      return { kind: 'allow' };
    case 'not_member':
      /**
       * Everyone who is not a member goes to Continue-as, saved place included.
       *
       * It is tempting to allow a `saved` session through and let RLS return an
       * empty screen, on the grounds that a permanent identity "should" already
       * be a member. But somebody with a saved place can perfectly well open a
       * friend's invite link on a circle they have never joined, and the
       * honest answer there is the same one a guest gets: this is not yours
       * yet, here is how to join. Continue-as also offers "I'm new here", which
       * is the branch they want.
       *
       * What a saved place must never be offered is a *reattachment* onto
       * somebody else's guest membership, and that is refused server-side:
       * `reattach-member` returns `caller_is_permanent`. The list is a list.
       */
      return { kind: 'continue_as' };
    case 'unknown':
      return { kind: 'wait' };
  }
}
