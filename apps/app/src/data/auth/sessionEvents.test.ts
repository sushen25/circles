import type { AuthChangeEvent } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

/**
 * Whoever was here has gone when the auth server says `SIGNED_OUT`, from this tab
 * or another, so a journey they were part-way through goes with them (SUS-162).
 * A guest becoming an account is `SIGNED_IN` and keeps theirs.
 */
let notify: ((event: AuthChangeEvent, session: null) => void) | undefined;
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

const { startSessionTracking } = await import('./session');
const { readJourney, writeJourney } = await import('./journey');

describe('a journey and the auth events', () => {
  it('is kept through a sign-in and forgotten at a sign-out observed from anywhere', () => {
    startSessionTracking();
    writeJourney('sent-one-step:abcdef', { email: 'priya@example.com' });

    notify?.('SIGNED_IN', null);
    expect(readJourney('sent-one-step:abcdef')).toBeDefined();

    notify?.('SIGNED_OUT', null);
    expect(readJourney('sent-one-step:abcdef')).toBeUndefined();
  });
});
