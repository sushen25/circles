import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * SUS-161: plan actions sit beside the plan, and the footer keeps the decision.
 * "Beside the plan" is document order: share and edit come before the first
 * card; the footer holds the primary, then the nudge and "Change my times"
 * together on one row (and "Change my times" alone where there is no nudge).
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
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const before = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.clearAllMocks();
  shareMessage.mockResolvedValue('copied');
});

describe('SUS-161: the footer keeps the decision', () => {
  it('options: share and edit come before the first card; the nudge and change my times follow the primary', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const share = button('Share the link again');
    const edit = button('Edit the plan');
    const change = button('Change my times');
    const firstCard = screen.getAllByRole('button', { name: /of 6/ })[0] as HTMLElement;
    const review = button(/^Review/);
    const nudge = button(/^Nudge/);

    for (const header of [share, edit]) expect(before(header, firstCard)).toBe(true);
    expect(before(firstCard, change)).toBe(true);
    expect(before(review, nudge)).toBe(true);
    expect(before(nudge, change)).toBe(true);
  });

  it('options with nobody to nudge: change my times alone follows the primary', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.ready,
      responded: fixture.noQuorum.responded,
      repliedCount: 6,
    });
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull();
    expect(before(button(/^Review/), button('Change my times'))).toBe(true);
  });

  it('waiting: the plan actions come before the answers card, change my times after it', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const so = screen.getByText('So far');
    expect(before(button('Share the link again'), so)).toBe(true);
    expect(before(so, button('Change my times'))).toBe(true);
  });

  it('no overlap: share comes before the unlock list, change my times after it', async () => {
    planCandidates.mockResolvedValue(fixture.noQuorum);
    show(flow());
    await screen.findByRole('button', { name: 'Share the link again' });

    const unlock = screen.getByRole('button', { name: /^Lower to/ });
    expect(before(button('Share the link again'), unlock)).toBe(true);
    expect(before(unlock, button('Change my times'))).toBe(true);
  });

  it('says what a share did beside the button that asked, so the footer nudge is not answered offscreen', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(flow());
    fireEvent.click(await screen.findByRole('button', { name: 'Share the link again' }));
    const copied = await screen.findByText(/^Copied/);
    expect(before(copied, button(/^Review/))).toBe(true);

    fireEvent.click(button(/^Nudge/));
    const after = await screen.findByText(/^Copied/);
    expect(before(button(/^Nudge/), after)).toBe(true);
    expect(screen.getAllByText(/^Copied/)).toHaveLength(1);
  });
});
