import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * SUS-161: plan actions sit beside the plan, and the footer keeps the decision.
 * "Beside the plan" is document order: the header's buttons come before the
 * first card, and the nudge comes after the primary.
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

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const flow = () => <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const before = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => vi.clearAllMocks());

describe('SUS-161: the footer keeps the decision', () => {
  it('options: share and edit come before the first card, the nudge after the primary', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const share = button('Share the link again');
    const edit = button('Edit the plan');
    const change = button('Change my times');
    const firstCard = screen.getAllByRole('button', { name: /of 6/ })[0] as HTMLElement;
    const review = button(/^Review/);
    const nudge = button(/^Nudge/);

    for (const header of [share, edit, change]) expect(before(header, firstCard)).toBe(true);
    expect(before(review, nudge)).toBe(true);
    for (const header of [share, edit, change]) expect(before(nudge, header)).toBe(false);
  });

  it('waiting: the plan actions come before the answers card', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const share = button('Share the link again');
    expect(before(share, screen.getByText('So far'))).toBe(true);
  });

  it('no overlap: share and change my times come before the unlock list', async () => {
    planCandidates.mockResolvedValue(fixture.noQuorum);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const unlock = screen.getByRole('button', { name: /^Lower to/ });
    expect(before(button('Share the link again'), unlock)).toBe(true);
    expect(before(button('Change my times'), unlock)).toBe(true);
  });
});
