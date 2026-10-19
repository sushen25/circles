import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * An answer never given opens empty, and the usual days wait for a tap (ADR
 * 0077 over ADR 0068 and ADR 0037, SUS-226, SUS-227): somebody who has offered
 * times before in the circle still lands with no day tapped, nothing is sent
 * and no draft is kept, and is offered "Use my usual days"; the tap, Undo, a
 * tap by hand and the analytics are here. The read and its reducer action are
 * `usePreviousTimes.test.tsx` and `usual.test.ts`. A plan about tonight offers
 * From now and Later tonight.
 */
vi.mock('expo-router', async () => {
  const { answerRouter } = await import('../../test/answer-router');
  return answerRouter({ replace: () => undefined, push: () => undefined });
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'nina', isAnonymous: true, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const planToAnswer = vi.fn();
const submitAnswer = vi.fn();
const usualTimes = vi.fn();
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  usualTimes: (...args: unknown[]) => usualTimes(...args),
  onChanceToResend: () => () => undefined,
}));
vi.mock('../../data/membership', () => ({ askToPlan: vi.fn() }));

const { AvailabilityFlow } = await import('./AvailabilityFlow');
const { readDraft } = await import('../../data/availability');
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;

function open(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <AvailabilityFlow code={PLAN.code} step="times" />
    </QueryClientProvider>,
  );
}

/** The days the person has tapped. */
const tapped = () => screen.queryAllByRole('button', { pressed: true });

beforeEach(() => {
  session.userId = 'nina';
  for (const mock of [planToAnswer, submitAnswer, usualTimes, track]) mock.mockReset();
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
  usualTimes.mockResolvedValue(['weekday_evening']);
});

afterEach(() => {
  vi.useRealTimers();
});

const EVENINGS = 'From 5:30 pm';

const OFFER = 'Use my usual days';
const SAYS = 'Weekday evenings, from your last plans in this circle.';
const offer = () => screen.queryByRole('button', { name: OFFER });
const tapOffer = () => fireEvent.click(screen.getByRole('button', { name: OFFER }));
const tapMonday = () => fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);

describe('an answer never given opens empty, whatever the person offered before', () => {
  it('taps no day, writes no line, sends nothing and keeps no draft, and offers the usual days', async () => {
    open();
    await screen.findByText('Which evenings could work?');
    expect(await screen.findByRole('button', { name: OFFER })).toBeVisible();
    expect(screen.getByText(SAYS)).toBeVisible();
    expect(tapped()).toHaveLength(0);
    expect(screen.queryByText(EVENINGS)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(await readDraft('nina', PLAN.code)).toBeUndefined();
    expect(usualTimes).toHaveBeenCalledTimes(1);
  });

  it('leaves a stored "none of these" as it is, with nothing tapped and no offer', async () => {
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { status: 'none_work', windows: [], submittedAt: '2026-09-01T09:00:00Z' },
    });
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    expect(offer()).toBeNull();
    expect(usualTimes).not.toHaveBeenCalled();
  });

  it('leaves an answer already given as it is, with no offer', async () => {
    planToAnswer.mockResolvedValue(answerable);
    open();
    await screen.findByRole('heading', { name: 'Your hours each evening' });
    await act(async () => undefined);
    // The stored answer's three days, not the ten weekdays.
    expect(tapped()).toHaveLength(3);
    expect(offer()).toBeNull();
    expect(usualTimes).not.toHaveBeenCalled();
  });
});

describe('who is offered "Use my usual days"', () => {
  it('does not offer it to a first-time guest, who has nothing in this circle', async () => {
    usualTimes.mockResolvedValue([]);
    const { container } = open();
    await screen.findByText('Which evenings could work?');
    await waitFor(() => expect(usualTimes).toHaveBeenCalled());
    await act(async () => undefined);
    expect(offer()).toBeNull();
    expect(container.textContent).not.toMatch(/usual/i);
  });

  it('does not offer it when none of the usual falls inside this plan', async () => {
    // Weekend mornings: the plan only asks about weekday evenings.
    usualTimes.mockResolvedValue(['weekend_morning']);
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(offer()).toBeNull();
  });

  it('offers nothing when the read fails: it is a shortcut, not an error', async () => {
    usualTimes.mockRejectedValue(new Error('down'));
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(offer()).toBeNull();
    expect(screen.queryByText(/went wrong/i)).toBeNull();
  });
});

describe('the tap, Undo and a tap by hand', () => {
  it('taps the usual days with their usual times and says so', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    expect(tapped()).toHaveLength(10);
    expect(screen.getByText(EVENINGS)).toBeVisible();
    expect(screen.getByText('Filled in from your usual days.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeEnabled();
    expect(offer()).toBeNull();
  });

  it('Undo returns to nothing tapped, and the offer is back', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(tapped()).toHaveLength(0);
    expect(screen.queryByText(EVENINGS)).toBeNull();
    expect(screen.queryByText('Filled in from your usual days.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    expect(screen.getByRole('button', { name: OFFER })).toBeVisible();
  });

  it('keeps no draft after Undo, so a reopened plan offers the usual days again', async () => {
    const first = open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    await waitFor(async () => expect(await readDraft('nina', PLAN.code)).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    await waitFor(async () => expect(await readDraft('nina', PLAN.code)).toBeUndefined());
    first.unmount();
    open();
    expect(await screen.findByRole('button', { name: OFFER })).toBeVisible();
  });

  it('is an ordinary answer afterwards: a day tapped off or on drops the note', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    fireEvent.click(tapped()[0]!);
    expect(tapped()).toHaveLength(9);
    expect(screen.queryByText('Filled in from your usual days.')).toBeNull();
    expect(offer()).toBeNull();
  });

  it('keeps the note when each day is only looked at: Adjust hours, then Same for every day', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust hours' }));
    expect(screen.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
    expect(screen.getByText('Filled in from your usual days.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Same for every day' }));
    expect(screen.getByText(EVENINGS)).toBeVisible();
    expect(tapped()).toHaveLength(10);
    expect(screen.getByText('Filled in from your usual days.')).toBeVisible();
  });

  it('hides the offer for good once any day is tapped by hand', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapMonday();
    expect(offer()).toBeNull();
    // Even with every day tapped off again.
    tapMonday();
    expect(tapped()).toHaveLength(0);
    expect(offer()).toBeNull();
  });
});

describe('what the answer is measured by', () => {
  const started = () => track.mock.calls.filter(([name]) => name === 'availability_started');

  it('says the offer was on show, once', async () => {
    open();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: true,
      }),
    );
    expect(started()).toHaveLength(1);
  });

  it('says nothing was offered to a first-time guest', async () => {
    usualTimes.mockResolvedValue([]);
    open();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
  });

  const send = async () => {
    submitAnswer.mockResolvedValue({ revision: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
    });
    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
  };

  it('says the usual days were used when the tap was used and the answer was sent', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    await send();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'availability_submitted',
        expect.objectContaining({ status: 'windows', usual_used: true }),
      ),
    );
  });

  it('says they were not used after Undo, or when the offer was ignored', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    tapMonday();
    await send();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'availability_submitted',
        expect.objectContaining({ usual_used: false }),
      ),
    );
  });

  it('says they were not used on an "I\'m easy" answer', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    fireEvent.click(screen.getByRole('switch'));
    await send();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'availability_submitted',
        expect.objectContaining({ status: 'flexible', usual_used: false }),
      ),
    );
  });

  it('carries no day-part in any event', async () => {
    open();
    await screen.findByRole('button', { name: OFFER });
    tapOffer();
    await send();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_submitted', expect.anything()),
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/weekday|weekend|morning|evening/);
  });
});

describe('a plan about tonight', () => {
  it('offers From now and Later tonight for its one day, From now first', async () => {
    // 5:10 pm on Monday 14 September 2099 in Melbourne; the plan asks about 5:30 to 11:30 pm.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-09-14T07:10:00.000Z'));
    usualTimes.mockResolvedValue([]);
    planToAnswer.mockResolvedValue({
      plan: {
        ...PLAN,
        windowStart: '2099-09-14',
        windowEnd: '2099-09-14',
        dailyEndMin: 23 * 60 + 30,
      },
      answer: null,
    });
    open();

    // Nothing is tapped for them: the one day is theirs to say yes to.
    await screen.findByText('Which days could work?');
    fireEvent.click(await screen.findByRole('button', { name: /^Monday/ }));
    expect(screen.getByText(/^From \d/)).toBeVisible();
    expect(await screen.findByRole('radio', { name: 'From now' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Later tonight' })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /^Evening/ })).toBeNull();
  });
});
