import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * The organiser changes their own times (SUS-158): the member's action on the
 * organiser's Waiting and Candidates screens, the same editor, and the same
 * behaviour once replies close or the plan is locked in.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const planCandidates = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
}));
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const { CandidatesFlow } = await import('./CandidatesFlow');
const fixture = await import('./fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const organiser = () => <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />;
const CHANGE = { name: 'Change my times' };

beforeEach(() => vi.clearAllMocks());

describe('Change my times, as the organiser', () => {
  it('opens the editor from the options and comes back to them afterwards', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(organiser());
    fireEvent.click(await screen.findByRole('button', CHANGE));
    expect(push).toHaveBeenCalledWith({
      pathname: '/j/[code]',
      params: { code: fixture.ready.code, returnTo: 'plan' },
    });
  });

  it('opens the editor from the waiting screen too', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(organiser());
    fireEvent.click(await screen.findByRole('button', CHANGE));
    expect(push).toHaveBeenCalledWith({
      pathname: '/j/[code]',
      params: { code: fixture.waiting.code, returnTo: 'plan' },
    });
  });

  it('is shown disabled, with why, on the waiting screen once replies have closed', async () => {
    planCandidates.mockResolvedValue({ ...fixture.waiting, repliesOpen: false });
    show(organiser());
    const button = await screen.findByRole('button', CHANGE);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText('Replies have closed, so times can no longer change.')).toBeTruthy();
  });

  it('is not offered on a locked-in plan: it is moved with the confirmed screen, not an answer', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed' });
    show(organiser());
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    expect(screen.queryByRole('button', CHANGE)).toBeNull();
  });

  it('does not change what a member is offered', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    show(organiser());
    fireEvent.click(await screen.findByRole('button', CHANGE));
    expect(push).toHaveBeenCalledWith({
      pathname: '/j/[code]',
      params: { code: fixture.readyAsMember.code },
    });
  });
});
