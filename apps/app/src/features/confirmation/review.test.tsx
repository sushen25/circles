import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';
import type * as Scheduling from '../../data/scheduling';
import { FunctionError } from '../../data/functions';

/**
 * The review screen (S1-28): what it shows, what a tap sends, and the two
 * things it must never do — confirm from a set it knows is behind, and resend
 * with a newer set to make a refusal go away.
 */

const push = vi.fn();
const replace = vi.fn();
const dismiss = vi.fn();
const canDismiss = vi.fn(() => true);
const focused = { current: true };
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push,
    replace,
    dismiss,
    canDismiss,
    back: vi.fn(),
    canGoBack: () => true,
  }),
  useFocusEffect: () => undefined,
  useIsFocused: () => focused.current,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));

const planCandidates = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
}));
const confirmMeetup = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  confirmMeetup: (...a: unknown[]) => confirmMeetup(...a),
}));

const { ReviewFlow } = await import('./ReviewFlow');
const fixture = await import('../scheduling/fixtures');

const THU = fixture.ready.candidates[0]!.id;

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const review = (candidate = THU) => (
  <ReviewFlow id="sunday-crew" planId="thu-17" candidate={candidate} />
);

const lockIn = () => screen.getByRole('button', { name: 'Lock it in' });

function refusal(reason: string): FunctionError {
  return new FunctionError(
    { error: 'refused', reason, message: 'Refused.', reference: 'REF-1' } as never,
    'Refused.',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  focused.current = true;
  canDismiss.mockReturnValue(true);
  planCandidates.mockResolvedValue(fixture.ready);
  confirmMeetup.mockResolvedValue({
    confirmation_id: 'c1',
    starts_at: THU,
    ends_at: fixture.ready.candidates[0]!.endsAt,
    going: ['maya', 'priya', 'tom', 'jess', 'sam'],
  });
});

describe('the organiser reviewing Thursday', () => {
  it('shows the option as the card said it, and names who has not replied', async () => {
    show(review());
    expect(await screen.findByText("5 of 6 can make it · Alex hasn't answered")).toBeTruthy();
    expect(screen.getByText(/^Alex hasn't replied\. They'll see the plan/)).toBeTruthy();
    expect(screen.getByText('Did you have to chase anyone outside the app?')).toBeTruthy();
  });

  it('asks the survey before it locks anything in', async () => {
    show(review());
    await screen.findByText('Lock it in?');
    expect(lockIn().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'One person' }));
    expect(lockIn().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends the start instant, the set it showed and the answers, then shows the confirmation', async () => {
    show(review());
    await screen.findByText('Lock it in?');
    fireEvent.change(screen.getByLabelText('Where it is'), { target: { value: 'Hope St Radio' } });
    fireEvent.change(screen.getByLabelText('A note for everyone'), {
      target: { value: 'Come hungry.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'More than one' }));
    // The tap's own re-read sees the option; every read after it sees the plan
    // locked in, as the lock-in's refetch will.
    planCandidates.mockResolvedValueOnce(fixture.ready);
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    fireEvent.click(lockIn());

    await waitFor(() => expect(confirmMeetup).toHaveBeenCalledTimes(1));
    expect(confirmMeetup).toHaveBeenCalledWith({
      planId: 'thu-17',
      candidateId: THU,
      expectedSetId: 'set-1',
      chasedAnswer: 'more',
      placeName: 'Hope St Radio',
      placeUrl: undefined,
      note: 'Come hungry.',
    });
    // Off the screen under the review — whichever door it was — and on to the
    // confirmed screen in the same tick, so nothing is left for Back to land
    // on and the screen underneath never shows.
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith());
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]!);
    // The refetch the lock-in causes reads the plan as locked in; it must not
    // send the organiser a second time.
    await waitFor(() => expect(planCandidates.mock.calls.length).toBeGreaterThanOrEqual(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('meetup_confirmed', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
      attending_count: 5,
      invited_count: 6,
    });
    expect(track).toHaveBeenCalledWith('organiser_chased', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
      answer: 'more',
    });
  });

  it('refuses a map link that is not a link before sending it', async () => {
    show(review());
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.change(screen.getByLabelText('A map link for the place'), {
      target: { value: 'javascript:alert(1)' },
    });
    expect(screen.getByText(/needs to be a link starting with https/)).toBeTruthy();
    expect(lockIn().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('a set that moves', () => {
  it('locks nothing in while the set is behind the plan', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, stale: true });
    show(review());
    expect(await screen.findByText(/Getting the latest before you lock it in/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    expect(lockIn().getAttribute('aria-disabled')).toBe('true');
  });

  it('sends nothing when the set changed between the render and the tap, and says so', async () => {
    show(review());
    await screen.findByText('Lock it in?');
    planCandidates.mockResolvedValue({
      ...fixture.ready,
      set: { ...fixture.ready.set!, id: 'set-2' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());

    expect(await screen.findByText(/Someone answered while you were looking/)).toBeTruthy();
    expect(confirmMeetup).not.toHaveBeenCalled();
  });

  it('meets stale_candidates by reading again, never by resending with the newer set', async () => {
    confirmMeetup.mockRejectedValue(refusal('stale_candidates'));
    show(review());
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());

    expect(await screen.findByText(/Someone answered while you were looking/)).toBeTruthy();
    expect(confirmMeetup).toHaveBeenCalledTimes(1);
  });

  it('says so when the time is no longer on offer', async () => {
    show(review('2026-09-30T08:30:00.000Z'));
    expect(await screen.findByText("That time isn't one of the options any more.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lock it in' })).toBeNull();
  });

  it('says there is nothing to pick yet, rather than blaming an answer', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(review());
    expect(await screen.findByText('There is nothing to lock in yet.')).toBeTruthy();
  });

  it('says a plan that was called off is not picking a time', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'cancelled', view: 'closed' });
    show(review());
    expect(await screen.findByText('This plan is not picking a time any more.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes to the confirmation when the plan was already locked in', async () => {
    confirmMeetup.mockRejectedValue(refusal('wrong_state'));
    show(review());
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    // Off the screen under the review — whichever door it was — and on to the
    // confirmed screen in the same tick, so nothing is left for Back to land
    // on and the screen underneath never shows.
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith());
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]!);
  });
});

describe('a route whose circle segment is wrong', () => {
  // The plan says which circle it belongs to; the URL only says a path.
  it("records and navigates by the plan's own circle", async () => {
    show(<ReviewFlow id="some-other-circle" planId="thu-17" candidate={THU} />);
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    // Off the screen under the review — whichever door it was — and on to the
    // confirmed screen in the same tick, so nothing is left for Back to land
    // on and the screen underneath never shows.
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith());
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]!);
    expect(track).toHaveBeenCalledWith('organiser_chased', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
      answer: 'none',
    });
  });
});

describe('a review with nothing under it', () => {
  it('replaces itself with the confirmed screen (a deep link)', async () => {
    canDismiss.mockReturnValue(false);
    show(review());
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('a lock-in that lands after Back', () => {
  // Back during "Locking it in" takes the review off the stack before the
  // answer lands. Whatever is on top then is not the review's to move: the
  // options forward themselves on the refetch, and circle home shows it.
  it('moves nothing that is not the review', async () => {
    let answer: (value: unknown) => void = () => undefined;
    confirmMeetup.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { unmount } = show(review());
    await screen.findByText('Lock it in?');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    await waitFor(() => expect(confirmMeetup).toHaveBeenCalled());
    unmount();
    answer({
      confirmation_id: 'c1',
      starts_at: THU,
      ends_at: fixture.ready.candidates[0]!.endsAt,
      going: ['maya'],
    });
    await waitFor(() => expect(track).toHaveBeenCalledWith('meetup_confirmed', expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dismiss).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('a screen that is not on top', () => {
  it('leaves a locked-in plan alone until it is', async () => {
    focused.current = false;
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(review());
    await waitFor(() => expect(planCandidates).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('a cached plan', () => {
  it('waits on a locked-in cache rather than calling the plan off', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['plan-candidates', 'thu-17', 'maya'], {
      ...fixture.ready,
      state: 'confirmed',
      view: 'closed',
    });
    planCandidates.mockReturnValue(new Promise(() => undefined));
    render(<QueryClientProvider client={client}>{review()}</QueryClientProvider>);
    expect(await screen.findByText('Getting the option')).toBeTruthy();
    expect(screen.queryByText('This plan is not picking a time any more.')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('somebody who is not organising', () => {
  it('sees no confirm controls at all', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    show(review());
    expect(await screen.findByText('Only the organiser locks a time in.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lock it in' })).toBeNull();
    expect(screen.queryByText('Did you have to chase anyone outside the app?')).toBeNull();
  });
});
