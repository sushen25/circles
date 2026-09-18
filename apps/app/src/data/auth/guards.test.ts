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
  it.each<RouteKind>(['public', 'guest', 'saved', 'organiser'])('waits on a %s route', (route) => {
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

describe('saved routes — starting a circle, account settings', () => {
  it('send nobody to the gate', () => {
    expect(guard({ route: 'saved', session: NOBODY })).toEqual({ kind: 'needs_saved_place' });
  });

  it('send a guest to the gate — organising needs a permanent identity (ADR 0004)', () => {
    expect(guard({ route: 'saved', session: GUEST })).toEqual({ kind: 'needs_saved_place' });
  });

  it('let a saved place through with no circle to belong to', () => {
    expect(guard({ route: 'saved', session: SAVED, membership: 'not_member' })).toEqual({
      kind: 'allow',
    });
  });

  it('let the app tier through, which is a saved place with a device', () => {
    expect(guard({ route: 'saved', session: APP })).toEqual({ kind: 'allow' });
  });
});

describe('organiser routes — organising inside a circle', () => {
  it('send a guest to the gate before asking about membership', () => {
    expect(guard({ route: 'organiser', session: GUEST, membership: 'member' })).toEqual({
      kind: 'needs_saved_place',
    });
  });

  it('let a saved-place member through', () => {
    expect(guard({ route: 'organiser', session: SAVED, membership: 'member' })).toEqual({
      kind: 'allow',
    });
  });

  it('stop a saved place who is not in this circle', () => {
    /**
     * A saved place following a link to a circle they have never joined would
     * otherwise reach the plan composer and be refused only on submit — after
     * filling it in. `create-plan` refuses them server-side either way; this is
     * about which screen they see, and §8.2 gates everything about a circle on
     * being an active member of it.
     */
    expect(guard({ route: 'organiser', session: SAVED, membership: 'not_member' })).toEqual({
      kind: 'join_as_account',
    });
  });

  it('wait while membership is still unknown, rather than opening the composer', () => {
    expect(guard({ route: 'organiser', session: SAVED, membership: 'unknown' })).toEqual({
      kind: 'wait',
    });
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

  it.each<[string, SessionState]>([
    ['a saved place', SAVED],
    ['the app tier', APP],
  ])(
    'offer %s who is not a member one tap to join as themselves, never the list',
    (_who, state) => {
      /**
       * ADR 0022, Decision 3. Tempting to allow this through and let RLS return
       * nothing, on the grounds that a permanent identity "should" already be a
       * member — but somebody with an account can open a friend's plan link on a
       * circle they have never joined. And the list is the wrong answer too:
       * every name on it is a guest, and `reattach-member` refuses an account
       * each one with `caller_is_permanent`.
       */
      expect(guard({ route: 'guest', session: state, membership: 'not_member' })).toEqual({
        kind: 'join_as_account',
      });
    },
  );

  it('treats an absent membership as unknown rather than as a refusal', () => {
    // The default matters: a caller that forgets the argument must get `wait`,
    // not `continue_as`, or a missing prop becomes a redirect.
    expect(guard({ route: 'guest', session: GUEST })).toEqual({ kind: 'wait' });
  });
});

describe('the table is total', () => {
  it('answers every combination without falling through', () => {
    const routes: RouteKind[] = ['public', 'guest', 'saved', 'organiser'];
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
