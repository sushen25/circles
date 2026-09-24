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
const focused = { current: true };
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo, back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => focused.current,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const planCandidates = vi.fn();
const lowerQuorum = vi.fn();
const previewQuorum = vi.fn();
const closeAttempt = vi.fn();
const previewWiderWindow = vi.fn();
const widenWindow = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
  lowerQuorum: (...a: unknown[]) => lowerQuorum(...a),
  previewQuorum: (...a: unknown[]) => previewQuorum(...a),
  closeAttempt: (...a: unknown[]) => closeAttempt(...a),
  previewWiderWindow: (...a: unknown[]) => previewWiderWindow(...a),
  widenWindow: (...a: unknown[]) => widenWindow(...a),
}));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));

const { CandidatesFlow } = await import('./CandidatesFlow');
const { MemberCandidatesFlow } = await import('./MemberCandidatesFlow');
const { CANDIDATES_POLL_MS, STALE_POLL_MS } = await import('./useCandidates');
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
  focused.current = true;
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

  it('counts the replies it is still waiting on, not the ones the set knew about', async () => {
    // A set one answer behind: `responded_count` says 4, the summaries say 5.
    planCandidates.mockResolvedValue({
      ...fixture.ready,
      stale: true,
      repliedCount: 4,
      responded: ['maya', 'priya', 'tom', 'jess', 'sam'],
    });
    show(organiser());

    fireEvent.click(await screen.findByRole('button', { name: 'Nudge Alex' }));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    // One person is named, so the message has to say one reply.
    expect(shareMessage.mock.calls[0]?.[0] as string).toContain('1 reply');
  });

  it('reads again quickly while an answer has landed and no set has caught up', async () => {
    // The first reply is in and the first calculation has not finished: the
    // waiting screen would otherwise sit on it for twenty seconds.
    planCandidates.mockResolvedValue({
      ...fixture.waiting,
      set: null,
      responded: ['maya'],
      repliedCount: 1,
    });
    vi.useFakeTimers();
    try {
      show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="waiting" />);
      await vi.waitFor(() => expect(planCandidates).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_POLL_MS + 100);
      });
      expect(planCandidates.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
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

  it('shares the waiting message, not the original ask, and counts rather than names', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="waiting" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share the link again' }));
    await waitFor(() => expect(shareMessage).toHaveBeenCalled());
    const message = shareMessage.mock.calls[0]?.[0] as string;
    expect(message).toContain('waiting on 4 replies');
    expect(message).not.toContain('Tom');
    expect(track).toHaveBeenCalledWith(
      'share_opened',
      expect.objectContaining({ kind: 'reminder' }),
    );
  });

  it('calls the reader "you" rather than reading their own name back at them', async () => {
    planCandidates.mockResolvedValue({ ...fixture.waiting, responded: [], repliedCount: 0 });
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="waiting" />);

    expect(await screen.findByText('Waiting on the first reply.')).toBeTruthy();
    expect(screen.getByText('Still to answer: you, Priya and 4 others.')).toBeTruthy();
  });
});

describe('the organiser, with no overlap', () => {
  beforeEach(() => planCandidates.mockResolvedValue(fixture.noQuorum));

  it('shows the closest, the rule, and what would unlock it', async () => {
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    expect(await screen.findByText("There wasn't enough overlap this time.")).toBeTruthy();
    expect(screen.getByText(/Nothing in the window works for at least 4 of you/)).toBeTruthy();
    expect(screen.getByText('Closest')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Lower to 3 people\./ })).toBeTruthy();
  });

  it("lowers the quorum, and says the number becomes the plan's own", async () => {
    lowerQuorum.mockResolvedValue(undefined);
    previewQuorum.mockResolvedValue({
      asked_again: [],
      fresh_ask: [],
      invalidating: [],
      bumps_revision: false,
      version: 'v-7',
    });
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    const lower = await screen.findByRole('button', { name: /^Lower to 3 people\./ });
    expect(screen.getByText(/keeps 3 as its number/)).toBeTruthy();
    fireEvent.click(lower);
    // Conditional on the version, because the decision is permanent.
    await waitFor(() => expect(lowerQuorum).toHaveBeenCalledWith(PLAN, 3, 'v-7'));
  });

  it('refuses to lower the quorum to a number the plan has already left behind', async () => {
    lowerQuorum.mockResolvedValue(undefined);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);
    const lower = await screen.findByRole('button', { name: /^Lower to 3 people\./ });

    // The answer that landed between the render and the tap: the closest time
    // is eligible on its own now, and lowering would be permanent and pointless.
    planCandidates.mockResolvedValue(fixture.ready);
    fireEvent.click(lower);

    expect(await screen.findByText(/Somebody answered while that was open/)).toBeTruthy();
    expect(previewQuorum).not.toHaveBeenCalled();
    expect(lowerQuorum).not.toHaveBeenCalled();
  });

  it('shows who a wider window costs before asking for it, and saves that preview', async () => {
    previewWiderWindow.mockResolvedValue({
      asked_again: ['maya', 'priya', 'tom'],
      fresh_ask: [],
      invalidating: ['window'],
      bumps_revision: true,
      version: 'v-1',
    });
    widenWindow.mockResolvedValue(undefined);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    const wider = await screen.findByRole('button', { name: /^Try a wider window\./ });
    expect(screen.getByText('Ask about 14 days instead of 7')).toBeTruthy();
    fireEvent.click(wider);

    // §5.3: exactly who is asked again, before saving — and the reader is "you".
    expect(await screen.findByText(/asked again: you, Priya and Tom\./)).toBeTruthy();
    await waitFor(() =>
      expect(previewWiderWindow).toHaveBeenCalledWith(PLAN, {
        start: '2026-09-14',
        end: '2026-09-27',
      }),
    );
    expect(widenWindow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    // The version the preview came back with, so a plan that moved is refused.
    await waitFor(() =>
      expect(widenWindow).toHaveBeenCalledWith(
        PLAN,
        { start: '2026-09-14', end: '2026-09-27' },
        'v-1',
      ),
    );
  });

  it('closes the sheet on a refusal, so the reason is readable and the retry is fresh', async () => {
    previewWiderWindow.mockResolvedValue({
      asked_again: ['priya'],
      fresh_ask: [],
      invalidating: ['window'],
      bumps_revision: true,
      version: 'v-1',
    });
    const { FunctionError } = await import('../../data/functions');
    const { Problem } = await import('@circles/contracts');
    widenWindow.mockRejectedValue(
      new FunctionError(
        Problem.parse({
          error: 'conflict',
          reason: 'preview_is_stale',
          message: 'moved',
          reference: 'ref',
        }),
        'moved',
      ),
    );
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    fireEvent.click(await screen.findByRole('button', { name: /^Try a wider window\./ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again' }));

    // The notice lives behind the sheet, so the refusal closes it. (In jsdom
    // the sheet stays in the DOM: `Modal` unmounts on an animation-end event
    // that never fires there, so what is asserted is the state behind it.)
    expect(await screen.findByText(/Somebody answered while that was open/)).toBeTruthy();
    expect(widenWindow).toHaveBeenCalledTimes(1);

    // And the next attempt takes a fresh preview rather than resending the
    // version the server just refused.
    fireEvent.click(screen.getByRole('button', { name: /^Try a wider window\./ }));
    await waitFor(() => expect(previewWiderWindow).toHaveBeenCalledTimes(2));
    expect(widenWindow).toHaveBeenCalledTimes(1);
  });

  it('says what each unlock does out loud, not only what it is called', async () => {
    planCandidates.mockResolvedValue(fixture.noQuorum);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    // An explicit label replaces the name built from the row, so "the plan
    // then keeps 3 as its number" has to be in it.
    const lower = await screen.findByRole('button', { name: /^Lower to 3 people\./ });
    expect(lower.getAttribute('aria-label')).toContain('keeps 3 as its number');
  });

  it('decides nothing from a set the plan has moved past', async () => {
    planCandidates.mockResolvedValue({ ...fixture.noQuorum, stale: true });
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    expect(await screen.findByText(/Someone just answered/)).toBeTruthy();
    // Lowering the quorum is permanent and its number comes from a near-miss
    // the newest answer may have moved.
    const lower = screen.getByRole('button', { name: /^Lower to 3 people\./ });
    expect(lower.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(lower);
    expect(lowerQuorum).not.toHaveBeenCalled();
  });

  it('asks before closing the attempt, and blames nobody when it does', async () => {
    closeAttempt.mockResolvedValue(undefined);
    show(<CandidatesFlow id={CIRCLE} planId={PLAN} which="no-quorum" />);

    fireEvent.click(await screen.findByRole('button', { name: /^Close this attempt\./ }));
    expect(await screen.findByText('Close this attempt?')).toBeTruthy();
    expect(screen.getByText(/No reason is given and nobody is named/)).toBeTruthy();
    expect(closeAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close it' }));
    await waitFor(() => expect(closeAttempt).toHaveBeenCalledWith(PLAN));
    await waitFor(() => expect(dismissTo).toHaveBeenCalled());
  });
});

describe('S1-26: editing and cancelling from the options', () => {
  it('offers the organiser the edit while the plan is still asking', async () => {
    planCandidates.mockResolvedValue(fixture.ready);
    show(organiser());
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/edit',
      params: { id: CIRCLE, planId: PLAN },
    });
  });

  it("offers the circle's owner a cancel on somebody else's plan, and a member nothing", async () => {
    planCandidates.mockResolvedValue({ ...fixture.readyAsMember, isOwner: true });
    show(<MemberCandidatesFlow code="pnsundaycr" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/cancel',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it('offers a member who does not own the circle no cancel', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    show(<MemberCandidatesFlow code="pnsundaycr" />);
    expect(await screen.findByText('Thursday looks good for five of you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel this plan' })).toBeNull();
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

  it('is offered no way to change times once replies have closed', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.readyAsMember,
      repliesOpen: false,
    });
    show(organiser());

    expect(await screen.findByText('Replies closed')).toBeTruthy();
    // `replace_response` would refuse the answer, so the editor is not offered.
    expect(screen.queryByRole('button', { name: 'Change my times' })).toBeNull();
  });

  it('is warned when the options were worked out before the newest answer', async () => {
    planCandidates.mockResolvedValue({ ...fixture.readyAsMember, stale: true });
    show(organiser());

    expect(await screen.findByText(/Someone just answered/)).toBeTruthy();
  });

  it('is shown no marks at all while reply state is not theirs to read', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.waiting,
      me: 'priya',
      isOrganiser: false,
      responded: null,
      repliedCount: 1,
    });
    show(organiser());

    expect(await screen.findByText('Waiting on a few more.')).toBeTruthy();
    expect(screen.getByText('1 of 6 replied')).toBeTruthy();
    // Six filled squares beside "1 of 6 replied" would say everybody answered.
    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('is never told there was no overlap from a set the plan has moved past', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.noQuorum,
      me: 'priya',
      isOrganiser: false,
      stale: true,
    });
    show(organiser());

    expect(await screen.findByText(/Someone just answered/)).toBeTruthy();
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

  it('has nothing to pick once the plan is off', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'cancelled', view: 'closed' });
    show(organiser());
    expect(await screen.findByText('This plan is decided.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  // S1-28: a locked-in plan's page is its confirmed screen, on either door.
  it('sends a locked-in plan to its confirmed screen', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(organiser());
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/confirmed',
        params: { id: CIRCLE, planId: PLAN },
      }),
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('This plan is decided.')).toBeNull();
  });

  // The confirmed door sends a reopened plan here; a cached "confirmed" from
  // before must not send it straight back before the fresh read lands.
  it('redirects on a fresh read only, never on what the cache said', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['plan-candidates', PLAN, 'maya'], {
      ...fixture.ready,
      state: 'confirmed',
      view: 'closed',
    });
    planCandidates.mockResolvedValue(fixture.ready);
    render(<QueryClientProvider client={client}>{organiser()}</QueryClientProvider>);
    expect(await screen.findByText('Thursday looks good for five of you.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('trusts no cached state when the refetch fails: it says so instead', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['plan-candidates', PLAN, 'maya'], {
      ...fixture.ready,
      state: 'confirmed',
      view: 'closed',
    });
    planCandidates.mockRejectedValue(new Error('candidates lookup failed'));
    render(<QueryClientProvider client={client}>{organiser()}</QueryClientProvider>);
    expect(await screen.findByText("We couldn't load the options.")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  // After a lock-in the options stay mounted under the confirmed screen and
  // see the same refetch. The redirect is spent only when they are on top, so
  // swiping back onto them still moves on.
  it('keeps its redirect for when it is the screen on top', async () => {
    focused.current = false;
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={client}>{organiser()}</QueryClientProvider>;
    const { rerender } = render(tree());
    await waitFor(() => expect(planCandidates).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();

    // The same mounted screen, brought back on top.
    focused.current = true;
    rerender(tree());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('sends a member nowhere while the plan page is not on top', async () => {
    focused.current = false;
    planCandidates.mockResolvedValue({
      ...fixture.readyAsMember,
      state: 'confirmed',
      view: 'closed',
    });
    show(<MemberCandidatesFlow code="pnsundaycr" />);
    await waitFor(() => expect(planCandidates).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a member on the plan link to the confirmed screen too', async () => {
    planCandidates.mockResolvedValue({
      ...fixture.readyAsMember,
      state: 'confirmed',
      view: 'closed',
    });
    show(<MemberCandidatesFlow code="pnsundaycr" />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/p/[code]/confirmed',
        params: { code: 'pnsundaycr' },
      }),
    );
    expect(screen.queryByText('This plan is decided.')).toBeNull();
  });
});
