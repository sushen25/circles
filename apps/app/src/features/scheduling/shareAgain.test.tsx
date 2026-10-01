import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * SUS-132: the plan's link, again, from every organiser view of a plan that is
 * still taking answers — and from none that is not.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const planCandidates = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
}));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));

const { CandidatesFlow } = await import('./CandidatesFlow');
const fixture = await import('./fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const flow = () => <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />;
const SHARE = { name: 'Share the link again' };

beforeEach(() => {
  vi.clearAllMocks();
  shareMessage.mockResolvedValue('sheet');
});

describe('SUS-132: share the link again', () => {
  it('is on the options while replies are open, and sends a count, never names', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(flow());

    fireEvent.click(await screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    const message = shareMessage.mock.calls[0]?.[0] as string;
    expect(message).toContain('waiting on 1 reply');
    expect(message).toContain('https://circles.test/');
    expect(message).not.toContain('Alex');
    expect(track).toHaveBeenCalledWith(
      'share_opened',
      expect.objectContaining({ kind: 'reminder' }),
    );
  });

  it('is on the options when everybody has answered, and asks for no replies', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.ready,
      repliedCount: fixture.ready.askedCount,
      responded: null,
    });
    show(flow());

    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    expect(shareMessage.mock.calls[0]?.[0] as string).not.toMatch(/waiting on 0/);
  });

  it('is on the no-quorum screen while replies are open', async () => {
    planCandidates.mockResolvedValue(fixture.noQuorum);
    show(flow());

    fireEvent.click(await screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    expect(shareMessage.mock.calls[0]?.[0] as string).toContain('circles.test');
  });

  it('is not on the no-quorum screen once replies have closed', async () => {
    planCandidates.mockResolvedValue({ ...fixture.noQuorum, repliesOpen: false });
    show(flow());

    expect(await screen.findByText("There wasn't enough overlap this time.")).toBeTruthy();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('is not on the replies-closed screen', async () => {
    planCandidates.mockResolvedValue(fixture.deadlinePassed);
    show(flow());

    expect(await screen.findByText(/Replies have closed/)).toBeTruthy();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it.each(['cancelled', 'confirmed'] as const)('is not on a plan that is %s', async (state) => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state, view: 'closed' });
    show(flow());

    await waitFor(() => expect(planCandidates).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });
});
