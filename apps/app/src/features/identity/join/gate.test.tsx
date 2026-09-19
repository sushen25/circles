import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two flows that act on their own when a route loads — the gate making a
 * session, the re-entry link spending its token — and what they do when that
 * first attempt does not work.
 */

const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
const track = vi.fn();
vi.mock('../../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../../data/auth/client', () => ({ hasBackend: () => true }));

const ensureGuestSession = vi.fn();
vi.mock('../../../data/auth/guest', () => ({ ensureGuestSession: () => ensureGuestSession() }));

const session = { status: 'none', userId: undefined, isAnonymous: false, isLoading: false };
vi.mock('../../../data/auth/session', () => ({
  useSession: () => session,
  sessionState: () => session,
  signOut: vi.fn(async () => undefined),
}));

const reattachWithToken = vi.fn();
const planAccess = vi.fn();
vi.mock('../../../data/membership', () => ({
  planAccess: (...args: unknown[]) => planAccess(...args),
  circleNameForCode: vi.fn(async () => 'Sunday Crew'),
  guestMembersFor: vi.fn(async () => ({ kind: 'listed', members: [] })),
  heldInvite: () => undefined,
  reattachFromList: vi.fn(),
  circleAccess: vi.fn(),
  arrivalFor: vi.fn(),
  reattachWithToken: (...args: unknown[]) => reattachWithToken(...args),
  joinPlan: vi.fn(),
}));

const { MembershipGate } = await import('./MembershipGate');
const { ReentryFlow } = await import('./ReentryFlow');
const { FunctionError } = await import('../../../data/functions');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  session.status = 'none';
  session.userId = undefined;
  track.mockReset();
  planAccess.mockReset();
  replace.mockReset();
  ensureGuestSession.mockReset();
  reattachWithToken.mockReset();
});

describe('MembershipGate', () => {
  it('tries to make a session again when Try again is pressed', async () => {
    ensureGuestSession.mockRejectedValueOnce(new Error('network')).mockResolvedValue({});

    render(
      wrap(<MembershipGate target={{ kind: 'plan', code: 'pnsundaycr' }}>{null}</MembershipGate>),
    );

    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      fireEvent.click(retry);
    });

    // Without a second attempt the session stays `none`, the decision stays
    // `needs_session`, and the page waits on a loading state until a reload.
    await waitFor(() => expect(ensureGuestSession).toHaveBeenCalledTimes(2));
  });
});

describe('session_missing_on_return', () => {
  it('is not counted for somebody who arrived with a session', async () => {
    // A guest from another circle, or an account opening a friend's plan: no
    // session was missing. Counting them inflates the continuity rate (§11.2).
    Object.assign(session, { status: 'guest', userId: 'someone' });
    planAccess.mockResolvedValue({ membership: 'not_member' });

    render(
      wrap(<MembershipGate target={{ kind: 'plan', code: 'pnsundaycr' }}>{null}</MembershipGate>),
    );

    // A circle with no guests goes straight to the name step (ADR 0022).
    await screen.findByText('What should the group call you?');
    expect(track).not.toHaveBeenCalledWith('session_missing_on_return', {});
  });

  it('is counted when the page had to make a session', async () => {
    ensureGuestSession.mockImplementation(async () => {
      Object.assign(session, { status: 'guest', userId: 'fresh' });
      return {};
    });
    planAccess.mockResolvedValue({ membership: 'not_member' });

    const { rerender } = render(
      wrap(<MembershipGate target={{ kind: 'plan', code: 'pnsundaycr' }}>{null}</MembershipGate>),
    );
    // The session store is a mock; a real one would re-render on the change.
    await waitFor(() => expect(ensureGuestSession).toHaveBeenCalled());
    rerender(
      wrap(<MembershipGate target={{ kind: 'plan', code: 'pnsundaycr' }}>{null}</MembershipGate>),
    );

    await waitFor(() => expect(track).toHaveBeenCalledWith('session_missing_on_return', {}));
  });
});

describe('ReentryFlow', () => {
  it('tells somebody signed in to another account so, rather than "expired"', async () => {
    // `reattach_member` lets the account the link names straight through; what
    // is left refused as `caller_is_permanent` is somebody else signed in. That
    // is not a dead link, and it is not their circles either.
    reattachWithToken.mockRejectedValue(
      new FunctionError(
        {
          error: 'forbidden',
          reason: 'caller_is_permanent',
          message: 'x',
          reference: 'R',
        } as never,
        'x',
      ),
    );

    render(wrap(<ReentryFlow token={'t'.repeat(40)} />));

    expect(await screen.findByText("You're signed in with a different account.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out and continue' })).toBeTruthy();
    expect(screen.queryByText('This link has expired.')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
