import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * Before anybody else has answered, the organiser sees the waiting state and
 * never "There wasn't enough overlap this time" (SUS-193). The rule is
 * `hasMissed` in the domain, applied where the read becomes a view; this walks
 * the screens on both sides of it.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
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
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const { CandidatesFlow } = await import('./CandidatesFlow');
const fixture = await import('./fixtures');
const { viewOf } = await import('../../data/scheduling/rows');

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />
    </QueryClientProvider>,
  );
}

/** The read of a circle of one: a defaulted quorum of 3, only the organiser in. */
function onlyTheOrganiser() {
  const base = fixture.noQuorum;
  const asking = { quorum: 3, answeredCount: 1, repliesOpen: true };
  return {
    ...base,
    quorum: 3,
    quorumChosen: false,
    roster: base.roster.slice(0, 1),
    participants: ['maya'],
    responded: ['maya'],
    repliedCount: 1,
    askedCount: 1,
    view: viewOf(base.state, base.candidates, base.nearMisses, asking),
  };
}

describe('the organiser, with only their own times in', () => {
  beforeEach(() => planCandidates.mockResolvedValue(onlyTheOrganiser()));

  it('sees the waiting state, with no overlap headline and no way to close the attempt', async () => {
    show();

    expect(await screen.findByText('Your times are in.')).toBeTruthy();
    expect(screen.getByText(/Options appear here as friends reply/)).toBeTruthy();
    expect(screen.getByText('Just you so far.')).toBeTruthy();
    expect(screen.queryByText(/Everyone has answered/)).toBeNull();
    expect(screen.getByText('Share the link again')).toBeTruthy();
    expect(screen.queryByText(/enough overlap/)).toBeNull();
    expect(screen.queryByText('Close this attempt')).toBeNull();
  });
});

describe('the organiser, once enough have answered and nothing lines up', () => {
  it('still sees the no-overlap screen, unchanged', async () => {
    planCandidates.mockResolvedValue(fixture.noQuorum);
    show();

    expect(await screen.findByText("There wasn't enough overlap this time.")).toBeTruthy();
    expect(screen.getByText('Close this attempt')).toBeTruthy();
  });
});
