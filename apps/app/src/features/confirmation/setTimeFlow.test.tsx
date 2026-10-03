import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';
import type * as Scheduling from '../../data/scheduling';
import { fixtureStretch } from './fixtureStretch';

/**
 * The time picker (ADR 0051): where it opens, what it says about who a time works
 * for as the time changes, and where its primary leads from each door.
 */

const push = vi.fn();
const replace = vi.fn();
const navigate = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push,
    replace,
    navigate,
    back: vi.fn(),
    canGoBack: () => true,
  }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
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
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  stretchOf: (...a: unknown[]) => stretchOf(...a),
}));
vi.mock('../../data/availability', () => ({ othersSaid: () => Promise.resolve(undefined) }));

const { SetTimeFlow } = await import('./SetTimeFlow');
const fixture = await import('../scheduling/fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const THU = fixture.ready.candidates[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  // The Sunday Crew's days are in September 2026, and a time that has gone is
  // refused: the clock is theirs, and still runs.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  planCandidates.mockResolvedValue(fixture.ready);
  stretchOf.mockImplementation((_plan: string, startsAt: string, endsAt: string) =>
    Promise.resolve(fixtureStretch(startsAt, endsAt)),
  );
});

afterEach(() => vi.useRealTimers());

describe('where the picker opens', () => {
  it('on the option that was selected, saying who it works for by name', async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start={THU.startsAt}
        end={THU.endsAt}
      />,
    );
    expect(await screen.findByText('Pick the time yourself')).toBeTruthy();
    expect(await screen.findByText('5 of 6 can make it')).toBeTruthy();
    expect(
      screen.getByText(/^You, Priya and 3 others can make it · Alex hasn't answered$/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review Thursday' })).toBeTruthy();
    // 5 of 6 meets the 4 the plan asked for, and the day was asked about: no caution.
    expect(screen.queryByText(/You can still lock it in/)).toBeNull();
  });

  it('on the first day the plan asks about, before any option exists', async () => {
    planCandidates.mockResolvedValue(fixture.waiting);
    show(<SetTimeFlow id="sunday-crew" planId="thu-17" mode="lock" />);
    expect(await screen.findByText('Starts 5:30 pm')).toBeTruthy();
    expect(screen.getByText('Ends 7:30 pm')).toBeTruthy();
    expect(screen.getByText('2 hours, as the plan asked.')).toBeTruthy();
  });
});

describe('the names as the time changes', () => {
  it('asks again when the time is stepped, and says the caution when it falls below the number', async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start={THU.startsAt}
        end={THU.endsAt}
      />,
    );
    await screen.findByText('5 of 6 can make it');
    // Starting an hour later keeps the length, and 7:30–9:30 pm is outside
    // everybody's Thursday windows but Jess's and Maya's.
    fireEvent.click(screen.getByRole('button', { name: 'Start later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start later' }));
    await waitFor(() => expect(stretchOf).toHaveBeenCalledTimes(2));
    expect(stretchOf.mock.calls[1]?.[1]).toBe('2026-09-17T09:30:00.000Z');
    expect(
      await screen.findByText(/^That's \d of you, and this plan asked for at least 4\./),
    ).toBeTruthy();
  });

  it('says plainly when the plan never asked about the day', async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start="2026-10-03T09:00:00.000Z"
        end="2026-10-03T11:00:00.000Z"
      />,
    );
    expect(await screen.findByText(/^The plan never asked about /)).toBeTruthy();
    expect(
      screen.getByText('Nobody was asked about this day, so nobody has said either way.'),
    ).toBeTruthy();
  });

  it('keeps the names a live region, so a screen reader hears them change', async () => {
    show(<SetTimeFlow id="sunday-crew" planId="thu-17" mode="lock" />);
    const count = await screen.findByText(/can make it$/);
    expect(count.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('will not lock in until it knows, and will not ask about a time that has gone', async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start="2020-09-17T08:30:00.000Z"
        end="2020-09-17T10:30:00.000Z"
      />,
    );
    const review = await screen.findByRole('button', { name: /^Review / });
    expect(review.getAttribute('aria-disabled')).toBe('true');
    expect(stretchOf).not.toHaveBeenCalled();
  });
});

describe('a time the clock never reads', () => {
  it('is not offered on the day clocks go forward: it says so, and will not review it', async () => {
    // Melbourne goes from 2 am to 3 am on 4 October 2026: 1:30 am is real.
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start="2026-10-03T15:30:00.000Z"
        end="2026-10-03T17:30:00.000Z"
      />,
    );
    await screen.findByText('Pick the time yourself');
    fireEvent.click(screen.getByRole('button', { name: 'Start later' }));
    expect(
      await screen.findByText(
        'That time does not happen on this day, because the clocks go forward. Pick another.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Review / }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});

describe('where the primary leads', () => {
  it('to the review with the start and end, for a time that is not an option', async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start="2026-09-18T09:00:00.000Z"
        end="2026-09-18T11:00:00.000Z"
      />,
    );
    await screen.findByText('2 of 6 can make it');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review Friday' }).getAttribute('aria-disabled'),
      ).not.toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review Friday' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/review',
      params: {
        id: 'sunday-crew',
        planId: 'thu-17',
        start: '2026-09-18T09:00:00.000Z',
        end: '2026-09-18T11:00:00.000Z',
      },
    });
  });

  it("to the options' own review when the time is exactly one of them: locked in as one", async () => {
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start={THU.startsAt}
        end={THU.endsAt}
      />,
    );
    await screen.findByText('5 of 6 can make it');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review Thursday' }).getAttribute('aria-disabled'),
      ).not.toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review Thursday' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/review',
      params: { id: 'sunday-crew', planId: 'thu-17', candidate: THU.id },
    });
  });

  it('back to the edit screen with the time, from the edit screen', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="edit"
        start="2026-09-19T09:00:00.000Z"
        end="2026-09-19T11:00:00.000Z"
      />,
    );
    await screen.findByText('3 of 6 can make it');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Use / }).getAttribute('aria-disabled')).not.toBe(
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Use / }));
    expect(navigate).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/edit-locked',
      params: {
        id: 'sunday-crew',
        planId: 'thu-17',
        start: '2026-09-19T09:00:00.000Z',
        end: '2026-09-19T11:00:00.000Z',
      },
    });
  });
});

describe('the eight states', () => {
  it('says only the organiser picks the time to everybody else', async () => {
    planCandidates.mockResolvedValue(fixture.readyAsMember);
    show(<SetTimeFlow id="sunday-crew" planId="thu-17" mode="lock" />);
    expect(await screen.findByText('Only the organiser picks the time.')).toBeTruthy();
  });

  it('says the plan is not picking a time when it is locked in already, and not before it is read', async () => {
    planCandidates.mockResolvedValue({ ...fixture.ready, state: 'confirmed', view: 'closed' });
    show(<SetTimeFlow id="sunday-crew" planId="thu-17" mode="lock" />);
    expect(await screen.findByText('This plan is not picking a time any more.')).toBeTruthy();
  });

  it('offers to try again when the plan could not be read', async () => {
    planCandidates.mockRejectedValue(new Error('no'));
    show(<SetTimeFlow id="sunday-crew" planId="thu-17" mode="lock" />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says the names could not be checked, and leaves the primary off', async () => {
    stretchOf.mockRejectedValue(new Error('no'));
    show(
      <SetTimeFlow
        id="sunday-crew"
        planId="thu-17"
        mode="lock"
        start={THU.startsAt}
        end={THU.endsAt}
      />,
    );
    expect(await screen.findByText("We couldn't check who it works for. Try again.")).toBeTruthy();
    const who = screen.getByRole('button', { name: 'Review Thursday' });
    expect(within(who).queryByText('Review Thursday')).toBeTruthy();
    expect(who.getAttribute('aria-disabled')).toBe('true');
  });
});
