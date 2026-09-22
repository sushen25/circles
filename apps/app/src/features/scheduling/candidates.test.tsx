import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';

/**
 * The organiser's and the member's view of a plan that is finding a time
 * (S1-27): which screen the data puts them on, what a card says, what a tap
 * sends, and the two things that must never happen — a non-responder inside
 * "can make it", and a review from a set the plan has moved past.
 */

const push = vi.fn();
const replace = vi.fn();
const dismissTo = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo, back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const planCandidates = vi.fn();
const lowerQuorum = vi.fn();
const closeAttempt = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
  lowerQuorum: (...a: unknown[]) => lowerQuorum(...a),
  closeAttempt: (...a: unknown[]) => closeAttempt(...a),
}));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));

const { CandidatesFlow } = await import('./CandidatesFlow');
const { CANDIDATES_POLL_MS } = await import('./useCandidates');
const fixture = await import('./fixtures');

const CIRCLE = 'sunday-crew';
const PLAN = 'thu-17';

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const organiser = () => <CandidatesFlow id={CIRCLE} planId={PLAN} which="candidates" />;

beforeEach(() => {
  vi.clearAllMocks();
  shareMessage.mockResolvedValue('sheet');
});

describe('the organiser, with options', () => {
  beforeEach(() => planCandidates.mockResolvedValue(fixture.ready));

  it('argues for each option without a tap, and never puts a non-responder in one', async () => {
    show(organiser());

    expect(await screen.findByText('Thursday looks good for five of you.')).toBeTruthy();
    expect(screen.getByText('Best attendance')).toBeTruthy();
    expect(screen.getByText('5 of 6')).toBeTruthy();
    expect(screen.getByText("Alex hasn't answered")).toBeTruthy();
    expect(screen.getByText("Doesn't work for Priya · Alex hasn't answered")).toBeTruthy();

    // Alex is dashed in the header and inside no "can make it" row.
    const canMakeIt = screen.getAllByRole('img').slice(1);
    for (const marks of canMakeIt) {
      expect(marks.getAttribute('aria-label')).not.toContain('Alex');
    }
  });

  it('records that the options were seen, once, as the organiser', async () => {
    show(organiser());
    await screen.findByText('Thursday looks good for five of you.');
    const viewed = track.mock.calls.filter(([name]) => name === 'candidate_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0]?.[1]).toMatchObject({ role: 'organiser' });
  });

  it('follows the selection with the button, and sends the start instant on', async () => {
    show(organiser());
    expect(await screen.findByRole('button', { name: 'Review Thursday' })).toBeTruthy();

    const saturday = fixture.ready.candidates[1];
    fireEvent.click(screen.getByRole('button', { name: /Sat.*19|19.*Sat/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review Saturday' })).toBeTruthy(),
    );
    expect(track).toHaveBeenCalledWith('candidate_selected', expect.objectContaining({ rank: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Review Saturday' }));
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ candidate: saturday?.id }),
      }),
    );
  });

  it('refuses to review a set the plan has moved past, and asks again sooner', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, stale: true });
    show(organiser());

    expect(await screen.findByText(/Someone just answered/)).toBeTruthy();
    const review = screen.getByRole('button', { name: 'Review Thursday' });
    fireEvent.click(review);
    expect(push).not.toHaveBeenCalled();
  });

  it('nudges with a count and never with names', async () => {
    show(organiser());
    fireEvent.click(await screen.findByRole('button', { name: 'Nudge Alex' }));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    const message = shareMessage.mock.calls[0]?.[0] as string;
    expect(message).toContain('1 reply');
    expect(message).not.toContain('Alex');
  });

  it('reads again while it is open', async () => {
    vi.useFakeTimers();
    try {
      show(organiser());
      await vi.waitFor(() => expect(planCandidates).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CANDIDATES_POLL_MS + 100);
      });
      expect(planCandidates.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the organiser, with nothing yet', () => {
  it('waits for people rather than reporting a failure', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="waiting" />);

    expect(await screen.findByText('Waiting on a few more.')).toBeTruthy();
    expect(screen.getByText('2 of 6 have answered.')).toBeTruthy();
    expect(screen.getByText('Still to answer: Tom, Jess and 2 others.')).toBeTruthy();
    // Never anybody else's windows: there is no such thing to show.
    expect(screen.queryByText(/6:30/)).toBeNull();
  });
});

describe('the organiser, with no overlap', () => {
  beforeEach(() => planCandidates.mockResolvedValue(fixture.noQuorum));

  it('shows the closest, the rule, and what would unlock it', async () => {
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    expect(await screen.findByText("There wasn't enough overlap this time.")).toBeTruthy();
    expect(screen.getByText(/Nothing in the window works for at least 4 of you/)).toBeTruthy();
    expect(screen.getByText('Closest')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lower to 3 people' })).toBeTruthy();
  });

  it("lowers the quorum, and says the number becomes the plan's own", async () => {
    lowerQuorum.mockResolvedValue(undefined);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    const lower = await screen.findByRole('button', { name: 'Lower to 3 people' });
    expect(screen.getByText(/keeps 3 as its number/)).toBeTruthy();
    fireEvent.click(lower);
    await waitFor(() => expect(lowerQuorum).toHaveBeenCalledWith(PLAN, 3));
  });

  it('asks before closing the attempt, and blames nobody when it does', async () => {
    closeAttempt.mockResolvedValue(undefined);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Close this attempt' }));
    expect(await screen.findByText('Close this attempt?')).toBeTruthy();
    expect(screen.getByText(/No reason is given and nobody is named/)).toBeTruthy();
    expect(closeAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close it' }));
    await waitFor(() => expect(closeAttempt).toHaveBeenCalledWith(PLAN));
    await waitFor(() => expect(dismissTo).toHaveBeenCalled());
  });
});

describe('a member', () => {
  it('sees the options with nothing to confirm', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    show(organiser());

    expect(await screen.findByText('Thursday looks good for five of you.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change my times' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull();
  });

  it('sees nothing of what has come in until options exist', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.waiting,
      me: 'priya',
      isOrganiser: false,
      responded: null,
    });
    show(organiser());

    expect(await screen.findByText('Waiting on a few more.')).toBeTruthy();
    expect(screen.queryByText(/have answered/)).toBeNull();
    expect(screen.queryByText(/Still to answer/)).toBeNull();
  });

  it("is told the closest it got is nobody's fault", async () => {
    planCandidates.mockResolvedValue({ ...fixture.noQuorum, me: 'priya', isOrganiser: false });
    show(organiser());

    expect(await screen.findByText("There wasn't enough overlap this time.")).toBeTruthy();
    expect(screen.queryByText('What would unlock it')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lower to/ })).toBeNull();
  });
});

describe('the states that are not the happy one', () => {
  it('says so when the read fails, and offers the retry', async () => {
    planCandidates.mockRejectedValue(new Error('candidates lookup failed'));
    show(organiser());
    expect(await screen.findByText("We couldn't load the options.")).toBeTruthy();
  });

  it("shows nothing of a plan that is not the reader's", async () => {
    planCandidates.mockResolvedValue(null);
    show(organiser());
    expect(await screen.findByText('This one is not yours to see.')).toBeTruthy();
  });

  it('has nothing to pick once the plan is decided', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(organiser());
    expect(await screen.findByText('This plan is decided.')).toBeTruthy();
  });
});
