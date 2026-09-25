import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * "Use my usual times" and tonight's editor, on the screen (ADR 0005, S2-06):
 * the tertiary appears for somebody with a usual and an empty answer, paints
 * their usual onto the grid, sends nothing by itself, and is gone once there
 * is an answer. A plan about tonight opens its one day ticked, with From now
 * and Later tonight.
 */
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'priya', isAnonymous: true, isLoading: false };
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

const usualButton = () => screen.queryByRole('button', { name: 'Use my usual times' });

beforeEach(() => {
  session.userId = 'priya';
  for (const mock of [planToAnswer, submitAnswer, usualTimes]) mock.mockReset();
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
  usualTimes.mockResolvedValue(['weekday_evening']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('use my usual times', () => {
  it('paints the usual weekday evenings, sends nothing, and keeps a draft', async () => {
    open();
    await waitFor(() => expect(usualButton()).not.toBeNull());
    expect(usualTimes).toHaveBeenCalledWith({
      circleId: PLAN.circleId,
      planId: PLAN.id,
      userId: 'priya',
    });

    fireEvent.click(usualButton()!);

    // The fortnight's ten weekdays, each listed in My answer; no weekend day.
    expect(await screen.findAllByRole('button', { name: /Adjust by the half hour$/ })).toHaveLength(
      10,
    );
    expect(screen.queryByRole('button', { name: /^Saturday.*Adjust/ })).toBeNull();
    expect(submitAnswer).not.toHaveBeenCalled();
    // An edit like any other: the device keeps it until it is sent.
    await waitFor(async () => expect(await readDraft('priya', PLAN.code)).toBeDefined());
    // Offered to start an answer, not to overwrite one.
    expect(usualButton()).toBeNull();
  });

  it('is not offered to somebody with no usual yet', async () => {
    usualTimes.mockResolvedValue(undefined);
    open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(usualButton()).toBeNull();
  });

  it('is read again when the editor opens again, so a new habit shows (review round 2)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    usualTimes.mockResolvedValue(undefined);
    const first = open(client);
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(usualButton()).toBeNull();
    first.unmount();

    // Another plan answered meanwhile: now there is a usual.
    usualTimes.mockResolvedValue(['weekday_evening']);
    open(client);
    await waitFor(() => expect(usualButton()).not.toBeNull());
  });

  it('is not offered over an answer already given', async () => {
    planToAnswer.mockResolvedValue(answerable);
    open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(usualButton()).toBeNull();
  });
});

describe('a plan about tonight', () => {
  it('opens its one day ticked, offering From now and Later tonight', async () => {
    // 5:10 pm on Monday 14 September 2099 in Melbourne; the plan asks about 5:30 to 11:30 pm.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-09-14T07:10:00.000Z'));
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

    expect(await screen.findByRole('checkbox', { name: /^From now/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /^Later tonight/ })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /^Evening/ })).toBeNull();
  });
});
