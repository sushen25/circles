import { describe, expect, it } from 'vitest';

import { guard, type Membership, type RouteKind } from './guards';
import type { SessionState } from './session';

/**
 * Every combination of who is here and what the route needs.
 *
 * The table is small enough to enumerate, and the expensive cases are the rare
 * ones: a signed-in member on their first render, a saved place opening a
 * circle they have never joined. Both look like ordinary bugs and are actually
 * somebody being told they are not who they are.
 */

function session(over: Partial<SessionState> = {}): SessionState {
  return { status: 'saved', userId: 'u', isAnonymous: false, isLoading: false, ...over };
}

const LOADING = session({ isLoading: true });
const NOBODY = session({ status: 'none', userId: undefined });
const GUEST = session({ status: 'guest', isAnonymous: true });
const SAVED = session({ status: 'saved' });
const APP = session({ status: 'app' });

describe('before the stored session has been read', () => {
  it.each<RouteKind>(['public', 'guest', 'organiser'])('waits on a %s route', (route) => {
    // The alarming failure this prevents: a signed-in member's first render
    // reads `none`, and they are sent to Continue-as — indistinguishable, from
    // where they are sitting, from having been silently signed out.
    expect(guard({ route, session: LOADING })).toEqual({ kind: 'wait' });
  });
});

describe('public routes', () => {
  it.each([
    ['nobody', NOBODY],
    ['a guest', GUEST],
    ['a saved place', SAVED],
  ])('let %s through', (_who, state) => {
    expect(guard({ route: 'public', session: state })).toEqual({ kind: 'allow' });
  });
});

describe('organiser routes', () => {
  it('send nobody to the gate', () => {
    expect(guard({ route: 'organiser', session: NOBODY })).toEqual({ kind: 'needs_saved_place' });
  });

  it('send a guest to the gate — organising needs a permanent identity (ADR 0004)', () => {
    expect(guard({ route: 'organiser', session: GUEST })).toEqual({ kind: 'needs_saved_place' });
  });

  it('let a saved place through', () => {
    expect(guard({ route: 'organiser', session: SAVED })).toEqual({ kind: 'allow' });
  });

  it('let the app tier through, which is a saved place with a device', () => {
    expect(guard({ route: 'organiser', session: APP })).toEqual({ kind: 'allow' });
  });
});

describe('guest routes', () => {
  it('ask for a session before anything else when there is none', () => {
    // §10: the session comes first, because `guest_members_for_reattach` is
    // granted to `authenticated` and not to `anon` — so even *asking* who is in
    // the circle needs one. Membership is not consulted; there is nobody to
    // have one.
    expect(guard({ route: 'guest', session: NOBODY, membership: 'not_member' })).toEqual({
      kind: 'needs_session',
    });
  });

  it('wait while membership is still being fetched', () => {
    expect(guard({ route: 'guest', session: GUEST, membership: 'unknown' })).toEqual({
      kind: 'wait',
    });
  });

  it.each<[string, SessionState]>([
    ['a guest', GUEST],
    ['a saved place', SAVED],
  ])('let %s through when they are a member', (_who, state) => {
    expect(guard({ route: 'guest', session: state, membership: 'member' })).toEqual({
      kind: 'allow',
    });
  });

  it('offer Continue-as to a guest who is not a member', () => {
    expect(guard({ route: 'guest', session: GUEST, membership: 'not_member' })).toEqual({
      kind: 'continue_as',
    });
  });

  it('offer it to a saved place too, rather than an empty screen', () => {
    /**
     * Tempting to allow this through and let RLS return nothing, on the grounds
     * that a permanent identity "should" already be a member. But somebody with
     * a saved place can open a friend's invite link to a circle they have never
     * joined, and the honest answer is the same one a guest gets: not yours
     * yet, here is the way in. Continue-as carries "I'm new here", which is the
     * branch they actually want.
     *
     * What they must never be offered is a reattachment onto somebody else's
     * guest membership — and that is refused server-side with
     * `caller_is_permanent`, not here.
     */
    expect(guard({ route: 'guest', session: SAVED, membership: 'not_member' })).toEqual({
      kind: 'continue_as',
    });
  });

  it('treats an absent membership as unknown rather than as a refusal', () => {
    // The default matters: a caller that forgets the argument must get `wait`,
    // not `continue_as`, or a missing prop becomes a redirect.
    expect(guard({ route: 'guest', session: GUEST })).toEqual({ kind: 'wait' });
  });
});

describe('the table is total', () => {
  it('answers every combination without falling through', () => {
    const routes: RouteKind[] = ['public', 'guest', 'organiser'];
    const sessions = [LOADING, NOBODY, GUEST, SAVED, APP];
    const memberships: Membership[] = ['member', 'not_member', 'unknown'];

    for (const route of routes) {
      for (const state of sessions) {
        for (const membership of memberships) {
          expect(guard({ route, session: state, membership })).toHaveProperty('kind');
        }
      }
    }
  });
});
