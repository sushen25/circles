import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * An answer never given opens empty, and tonight's editor (ADR 0077 over ADR
 * 0068 and ADR 0037, SUS-226): somebody who has offered times before in the
 * circle still lands with no day tapped, nothing is sent and no draft is kept,
 * and the analytics say so truthfully. The read and its reducer action are
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

describe('an answer never given opens empty, whatever the person offered before', () => {
  it('taps no day, writes no line, sends nothing and keeps no draft, then lets the person tap', async () => {
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    expect(screen.queryByText(EVENINGS)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Use my previous times/ })).toBeNull();
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(await readDraft('nina', PLAN.code)).toBeUndefined();
    // Nothing reads previous times on open: there is nothing to apply them to.
    expect(usualTimes).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
    expect(tapped()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeEnabled();
  });

  it('leaves a stored "none of these" as it is, with nothing tapped', async () => {
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { status: 'none_work', windows: [], submittedAt: '2026-09-01T09:00:00Z' },
    });
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
  });

  it('leaves an answer already given as it is', async () => {
    planToAnswer.mockResolvedValue(answerable);
    open();
    await screen.findByRole('heading', { name: 'Your hours each evening' });
    await act(async () => undefined);
    // The stored answer's three days, not the ten weekdays.
    expect(tapped()).toHaveLength(3);
  });

  it('is never worded as "usual", anywhere on the screen', async () => {
    const { container } = open();
    await screen.findByText('Which evenings could work?');
    expect(container.textContent).not.toMatch(/usual/i);
  });
});

describe('what the answer is measured by', () => {
  it('says on the start that nothing was offered, and on the send that nothing was used', async () => {
    open();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
    expect(track.mock.calls.filter(([name]) => name === 'availability_started')).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
    submitAnswer.mockResolvedValue({ revision: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
    });
    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'availability_submitted',
        expect.objectContaining({ status: 'windows', usual_used: false }),
      ),
    );
  });

  it('carries no day-part in any event', async () => {
    open();
    await waitFor(() => expect(track).toHaveBeenCalled());
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
