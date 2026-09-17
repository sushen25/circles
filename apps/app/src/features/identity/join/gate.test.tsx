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
vi.mock('../../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../../data/auth/client', () => ({ hasBackend: () => true }));

const ensureGuestSession = vi.fn();
vi.mock('../../../data/auth/guest', () => ({ ensureGuestSession: () => ensureGuestSession() }));

const session = { status: 'none', userId: undefined, isAnonymous: false, isLoading: false };
vi.mock('../../../data/auth/session', () => ({ useSession: () => session }));

const reattachWithToken = vi.fn();
vi.mock('../../../data/membership', () => ({
  planAccess: vi.fn(),
  circleAccess: vi.fn(),
  arrivalFor: vi.fn(),
  reattachWithToken: (...args: unknown[]) => reattachWithToken(...args),
}));

const { MembershipGate } = await import('./MembershipGate');
const { ReentryFlow } = await import('./ReentryFlow');
const { FunctionError } = await import('../../../data/functions');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
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

describe('ReentryFlow', () => {
  it('sends somebody already signed in to their circles, not to "expired"', async () => {
    // The membership the link was for has saved its place, and this browser is
    // that account: `reattach_member` refuses the caller as permanent. That is
    // the right identity already here (architecture §10), not a dead link.
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

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(screen.queryByText('This link has expired.')).toBeNull();
  });
});
