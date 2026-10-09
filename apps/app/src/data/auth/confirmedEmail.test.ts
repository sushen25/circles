import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session's confirmed address (SUS-164): present only for a permanent
 * identity whose sign-in address auth has confirmed, because only that is proof
 * for the Sent card's one button (ADR 0055). Anything else gets the field.
 */
let notify: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
vi.mock('./client', () => ({
  authClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (callback: typeof notify) => {
        notify = callback;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  }),
}));

const { startSessionTracking, sessionState, resetSessionForTests } = await import('./session');

function userSession(user: Record<string, unknown>): Session {
  return { access_token: 'a', user: { id: 'u', ...user } } as unknown as Session;
}

async function signIn(user: Record<string, unknown>) {
  notify?.('SIGNED_IN', userSession(user));
  await vi.waitFor(() => expect(sessionState().userId).toBe('u'));
}

beforeEach(() => {
  resetSessionForTests();
  startSessionTracking();
});

describe('confirmedEmail', () => {
  it('is the confirmed address, lower-cased and trimmed, for a saved place', async () => {
    await signIn({ email: ' NINA@example.com ', email_confirmed_at: '2026-10-06T00:00:00Z' });

    expect(sessionState().confirmedEmail).toBe('nina@example.com');
  });

  it('is absent when auth has not confirmed the address', async () => {
    await signIn({ email: 'nina@example.com', email_confirmed_at: null });

    expect(sessionState().confirmedEmail).toBeUndefined();
  });

  it('is absent for an anonymous guest, whatever it holds', async () => {
    await signIn({
      is_anonymous: true,
      email: 'nina@example.com',
      email_confirmed_at: '2026-10-06T00:00:00Z',
    });

    expect(sessionState().confirmedEmail).toBeUndefined();
  });

  it('is absent with no address, and after sign-out', async () => {
    await signIn({ email_confirmed_at: '2026-10-06T00:00:00Z' });
    expect(sessionState().confirmedEmail).toBeUndefined();

    await signIn({ email: 'nina@example.com', email_confirmed_at: '2026-10-06T00:00:00Z' });
    expect(sessionState().confirmedEmail).toBe('nina@example.com');
    notify?.('SIGNED_OUT', null);
    await vi.waitFor(() => expect(sessionState().userId).toBeUndefined());
    expect(sessionState().confirmedEmail).toBeUndefined();
  });
});
