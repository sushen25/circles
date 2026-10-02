import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';
import type * as Scheduling from '../../data/scheduling';
import { FunctionError } from '../../data/functions';
import { fixtureStretch } from './fixtureStretch';

/**
 * Reviewing a time the organiser chose (ADR 0050): what it shows, what a tap
 * sends, and the one thing it must never do: freeze names nobody saw.
 */

const push = vi.fn();
const replace = vi.fn();
const dismiss = vi.fn();
const focused = { current: true };
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push,
    replace,
    dismiss,
    canDismiss: () => true,
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
const stretchOf = vi.fn();
const confirmOwnTime = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  stretchOf: (...a: unknown[]) => stretchOf(...a),
  confirmOwnTime: (...a: unknown[]) => confirmOwnTime(...a),
}));

const { ReviewFlow } = await import('./ReviewFlow');
const fixture = await import('../scheduling/fixtures');

const START = '2026-09-18T09:00:00.000Z';
const END = '2026-09-18T11:00:00.000Z';

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const review = () => (
  <ReviewFlow id="sunday-crew" planId="thu-17" candidate={undefined} start={START} end={END} />
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  focused.current = true;
  planCandidates.mockResolvedValue(fixture.ready);
  stretchOf.mockImplementation((_plan: string, startsAt: string, endsAt: string) =>
    Promise.resolve(fixtureStretch(startsAt, endsAt)),
  );
  confirmOwnTime.mockResolvedValue({
    confirmation_id: 'c1',
    starts_at: START,
    ends_at: END,
    going: ['priya', 'tom'],
  });
});
afterEach(() => vi.useRealTimers());

describe('the organiser reviewing their own time', () => {
  it('shows the time, who it works for by name, and one caution in place of the unanswered warning', async () => {
    show(review());
    expect(await screen.findByText('Lock it in?')).toBeTruthy();
    expect(
      await screen.findByText("2 of 6 can make it · Not you, Jess or Sam · Alex hasn't answered"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This isn't one of the options, and the plan asked for at least 4. Jess, Sam and Alex didn't put this time down. They'll see the plan and can say whether they're coming.",
      ),
    ).toBeTruthy();
    // Not the options' warning about who has not replied.
    expect(screen.queryByText(/haven't replied|hasn't replied/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lock it in' })).toBeTruthy();
  });

  it('asks the survey before it locks anything in', async () => {
    show(review());
    await screen.findByText('Lock it in?');
    await screen.findByText(/can make it ·/);
    expect(lockIn().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'One person' }));
    expect(lockIn().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends the stretch and the version of the names it showed, and says only counts and booleans', async () => {
    show(review());
    await screen.findByText(/can make it ·/);
    fireEvent.change(screen.getByLabelText('Where it is'), { target: { value: 'Hope St Radio' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());

    await waitFor(() => expect(confirmOwnTime).toHaveBeenCalledTimes(1));
    expect(confirmOwnTime).toHaveBeenCalledWith({
      planId: 'thu-17',
      startsAt: START,
      endsAt: END,
      expectedInputVersion: 5,
      chasedAnswer: 'none',
      placeName: 'Hope St Radio',
      placeUrl: undefined,
      note: undefined,
    });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('meetup_confirmed', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        attending_count: 2,
        invited_count: 6,
        own_time: true,
        below_quorum: true,
      }),
    );
    // Off the review and the picker beneath it, then on to the confirmed screen.
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(2));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]!);
  });

  it('does not freeze names nobody saw: an answer landing before the tap is noticed, and nothing is sent', async () => {
    show(review());
    await screen.findByText(/can make it ·/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    // Somebody answered between the render and the tap.
    stretchOf.mockResolvedValue({ ...fixtureStretch(START, END), inputVersion: 6 });
    fireEvent.click(lockIn());

    expect(
      await screen.findAllByText(
        'Someone answered while you were looking, so this is updated. Check who it works for, then lock it in.',
      ),
    ).not.toHaveLength(0);
    expect(confirmOwnTime).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says the same when the server finds the names are behind, and does not resend under the newer version', async () => {
    confirmOwnTime.mockRejectedValue(refusal('stale_availability'));
    show(review());
    await screen.findByText(/can make it ·/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    expect(
      await screen.findAllByText(
        'Someone answered while you were looking, so this is updated. Check who it works for, then lock it in.',
      ),
    ).not.toHaveLength(0);
    expect(confirmOwnTime).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('says what went wrong for a time the database refuses, and for a plan that is already locked in', async () => {
    confirmOwnTime.mockRejectedValue(refusal('own_time_in_the_past'));
    show(review());
    await screen.findByText(/can make it ·/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(lockIn());
    expect(
      await screen.findByText('That time has already started. Pick another from the options.'),
    ).toBeTruthy();
  });
});

describe('the states', () => {
  it('shows nothing to a member but that only the organiser locks a time in', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    // The organiser-only read refuses them, which must not show ahead of the answer.
    stretchOf.mockRejectedValue(new Error('stretch_availability failed'));
    show(review());
    expect(await screen.findByText('Only the organiser locks a time in.')).toBeTruthy();
    expect(confirmOwnTime).not.toHaveBeenCalled();
  });

  it('says it cannot be locked in for a time that has passed since the picker', async () => {
    vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
    show(review());
    expect(await screen.findByText("That time can't be locked in.")).toBeTruthy();
  });

  it('says the plan is not picking a time when it already is not', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'cancelled', view: 'closed' });
    show(review());
    expect(await screen.findByText('This plan is not picking a time any more.')).toBeTruthy();
  });

  it('sends a plan locked in elsewhere on to the confirmed screen', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(review());
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });
});
