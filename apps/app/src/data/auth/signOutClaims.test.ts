import type { AuthChangeEvent } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A pending identity claim holds another identity's access and refresh tokens.
 * The person it was kept for has signed out, so on a shared browser it must not
 * stay behind for whoever is next (SUS-192).
 */
const KEY = 'circles.pending_claims';
const MINE = '22222222-2222-4222-8222-222222222222';
const THEIRS = '33333333-3333-4333-8333-333333333333';

const claim = (id: string) => ({
  anonymous_session: 'anon.token',
  anonymous_refresh_token: 'anon.refresh.v1',
  idempotency_key: 'k'.repeat(32),
  moment: 'after_answer',
  destination_user_id: id,
  created_at: Date.now(),
});

let notify: ((event: AuthChangeEvent, session: unknown) => void) | undefined;
const signOutCall = vi.fn();
const SESSION = { access_token: 'saved.token', user: { id: MINE, is_anonymous: false } };

vi.mock('./client', () => ({
  authClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: SESSION } }),
      onAuthStateChange: (callback: typeof notify) => {
        notify = callback;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: signOutCall,
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
    functions: { invoke: () => new Promise(() => undefined) },
  }),
}));

const { signOut, startSessionTracking } = await import('./session');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stored = (): Record<string, unknown> =>
  JSON.parse(globalThis.localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;

beforeEach(async () => {
  globalThis.localStorage.clear();
  signOutCall.mockReset();
  signOutCall.mockResolvedValue({ error: null });
  startSessionTracking();
  await flush();
  globalThis.localStorage.setItem(
    KEY,
    JSON.stringify({ [MINE]: claim(MINE), [THEIRS]: claim(THEIRS) }),
  );
});

describe('signing out', () => {
  it('clears the claims kept for the identity that is leaving, and only theirs', async () => {
    await signOut();

    expect(Object.keys(stored())).toEqual([THEIRS]);
  });

  it('keeps them when the sign-out failed: the person is still in', async () => {
    signOutCall.mockResolvedValue({ error: { message: 'storage' } });
    await expect(signOut()).rejects.toThrow();

    expect(Object.keys(stored()).sort()).toEqual([MINE, THEIRS]);
  });

  it('does the same when the sign-out is observed from another tab', async () => {
    notify?.('SIGNED_OUT', null);
    await flush();

    expect(Object.keys(stored())).toEqual([THEIRS]);
  });
});
