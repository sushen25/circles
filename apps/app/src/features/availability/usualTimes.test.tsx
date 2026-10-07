import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * "Use my previous times" and tonight's editor, on the screen (ADR 0005,
 * S2-06, SUS-159): the tertiary appears, with a hint naming what it paints, for
 * somebody who has offered times before in the circle and has an empty answer;
 * it paints them onto the grid, sends nothing by itself, is gone once there is
 * an answer, and its use is measured with booleans only. A plan about tonight opens its one day ticked, with From now
 * and Later tonight.
 */
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
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

const previousButton = () => screen.queryByRole('button', { name: /^Use my previous times/ });

beforeEach(() => {
  session.userId = 'priya';
  for (const mock of [planToAnswer, submitAnswer, usualTimes, track]) mock.mockReset();
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
  usualTimes.mockResolvedValue(['weekday_evening']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('use my previous times', () => {
  it('is offered with a hint naming what it paints; paints it, sends nothing, keeps a draft', async () => {
    open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    // One request, for this plan: the member is the session, never a parameter.
    expect(usualTimes).toHaveBeenCalledTimes(1);
    expect(usualTimes).toHaveBeenCalledWith(PLAN.id);
    expect(screen.getByText('Weekday evenings. Nothing is sent until you send it.')).toBeVisible();
    // The hint is in the button's accessible name too.
    expect(
      screen.getByRole('button', {
        name: 'Use my previous times. Weekday evenings. Nothing is sent until you send it.',
      }),
    ).toBeVisible();

    fireEvent.click(previousButton()!);

    // The fortnight's ten weekdays, each listed in My answer; no weekend day.
    expect(await screen.findAllByRole('button', { name: /Adjust by the half hour$/ })).toHaveLength(
      10,
    );
    expect(screen.queryByRole('button', { name: /^Saturday.*Adjust/ })).toBeNull();
    expect(submitAnswer).not.toHaveBeenCalled();
    // An edit like any other: the device keeps it until it is sent.
    await waitFor(async () => expect(await readDraft('priya', PLAN.code)).toBeDefined());
    // Offered to start an answer, not to overwrite one.
    expect(previousButton()).toBeNull();
  });

  it('after several earlier answers names every part offered, once or often', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekend_morning', 'weekend_afternoon']);
    // A plan asking about the whole day, so every part has somewhere to go.
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, dailyStartMin: 9 * 60, dailyEndMin: 22 * 60 + 30 },
      answer: null,
    });
    open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    expect(
      screen.getByText(
        'Weekday evenings, weekend mornings and weekend afternoons. Nothing is sent until you send it.',
      ),
    ).toBeVisible();
    fireEvent.click(previousButton()!);
    expect((await screen.findAllByRole('button', { name: /^Saturday.*Adjust/ }))[0]).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Monday.*Adjust/ })[0]).toBeVisible();
  });

  it('names only the parts the plan paints: a part it does not ask about is not in the hint', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekday_morning']);
    open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    // The fixture asks about evenings only.
    expect(screen.getByText('Weekday evenings. Nothing is sent until you send it.')).toBeVisible();
    expect(screen.queryByText(/mornings/)).toBeNull();
  });

  it('is not offered when nothing was offered before, or when it would paint nothing here', async () => {
    usualTimes.mockResolvedValue([]);
    const first = open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(previousButton()).toBeNull();
    first.unmount();

    usualTimes.mockResolvedValue(['weekday_morning']);
    open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(previousButton()).toBeNull();
  });

  it('is not offered, and the editor still works, when the read fails', async () => {
    usualTimes.mockRejectedValue(new Error('offline'));
    open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(previousButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeVisible();
  });

  it('is read again when the editor opens again, so a new answer shows (review round 2)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    usualTimes.mockResolvedValue([]);
    const first = open(client);
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(previousButton()).toBeNull();
    first.unmount();

    // Another plan answered meanwhile: now there is something to offer.
    usualTimes.mockResolvedValue(['weekday_evening']);
    open(client);
    await waitFor(() => expect(previousButton()).not.toBeNull());
  });

  it('is not offered over an answer already given', async () => {
    planToAnswer.mockResolvedValue(answerable);
    open();
    await screen.findByText("Times I'd actually be up for");
    await act(async () => undefined);
    expect(previousButton()).toBeNull();
  });

  it('is never worded as "usual", anywhere on the screen', async () => {
    const { container } = open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    expect(container.textContent).not.toMatch(/usual/i);
    expect(container.innerHTML).not.toMatch(/usual/i);
  });
});

describe('what the previous times are measured by', () => {
  it('says on the start whether it was offered, and on the send whether it began from it', async () => {
    open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: true,
      }),
    );

    fireEvent.click(previousButton()!);
    // Edited afterwards, and still counted as begun from it.
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /^Monday.*Adjust by the half hour$/ }))[0]!,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^Clear Monday/ })[0]!);
    submitAnswer.mockResolvedValue({ revision: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
    });
    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'availability_submitted',
        expect.objectContaining({ status: 'windows', usual_used: true }),
      ),
    );
  });

  it('says it was not offered, and not used, with nothing to offer', async () => {
    usualTimes.mockResolvedValue([]);
    open();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
  });

  it('never holds the start back for a read that does not come: it goes without the flag', async () => {
    usualTimes.mockReturnValue(new Promise(() => undefined));
    open();
    await screen.findByText("Times I'd actually be up for");
    expect(track).not.toHaveBeenCalled();
    await waitFor(
      () => expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id }),
      {
        timeout: 3000,
      },
    );
  });

  it('still counts an opening left before the read came back, without the flag', async () => {
    usualTimes.mockReturnValue(new Promise(() => undefined));
    const opened = open();
    await screen.findByText("Times I'd actually be up for");
    expect(track).not.toHaveBeenCalledWith('availability_started', expect.anything());
    opened.unmount();
    expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('carries no day-part in any event', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekend_morning']);
    open();
    await waitFor(() => expect(previousButton()).not.toBeNull());
    await waitFor(() => expect(track).toHaveBeenCalled());
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/weekday|weekend|morning|evening/);
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
