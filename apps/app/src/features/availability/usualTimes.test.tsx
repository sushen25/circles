import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { tap } from '../../test/tap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * Previous times and tonight's editor, on the screen (ADR 0005, S2-06, SUS-159,
 * ADR 0068): somebody who has offered times before in the circle lands with
 * the days those times cover already tapped and the answer line written, as an
 * answer nobody has given yet. Nothing is sent by itself and no draft is kept
 * until they change something; it never overwrites an answer; and its use is
 * measured with booleans only. A plan about tonight offers From now and Later
 * tonight.
 */
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
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
const prefilled = (n: number) => waitFor(() => expect(tapped()).toHaveLength(n));
const EVENINGS = 'Evenings, from 5:30 pm';

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

describe('previous times', () => {
  it('land pre-filled: the weekday evenings tapped, the line written, nothing sent and no draft yet', async () => {
    open();
    await prefilled(10);
    // One request, for this plan: the member is the session, never a parameter.
    expect(usualTimes).toHaveBeenCalledTimes(1);
    expect(usualTimes).toHaveBeenCalledWith(PLAN.id);
    expect(screen.getByText(EVENINGS)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeEnabled();
    // The fortnight's ten weekdays, and no weekend day.
    expect(screen.getAllByRole('button', { name: /^Saturday/ })[0]).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('button', { name: /^Use my previous times/ })).toBeNull();
    expect(submitAnswer).not.toHaveBeenCalled();
    // A start, not an edit: the device keeps nothing until the person changes it.
    await act(async () => undefined);
    expect(await readDraft('nina', PLAN.code)).toBeUndefined();

    // Untapping a day is theirs, and from then on it is kept like any answer.
    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
    await waitFor(async () => expect(await readDraft('nina', PLAN.code)).toBeDefined());
    expect(tapped()).toHaveLength(9);
  });

  it('after several earlier answers taps every part offered, once or often', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekend_morning', 'weekend_afternoon']);
    // A plan asking about the whole day, so every part has somewhere to go.
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, dailyStartMin: 9 * 60, dailyEndMin: 22 * 60 + 30 },
      answer: null,
    });
    open();
    await prefilled(14);
    expect(screen.getAllByRole('button', { name: /^Saturday/ })[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('button', { name: /^Monday/ })[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Evenings on weekdays and the daytime on weekends: the line says so in counts.
    expect(screen.getByText('10 evenings, 4 daytimes')).toBeVisible();
  });

  it('tap only the parts the plan paints: a part it does not ask about adds nothing', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekday_morning']);
    open();
    await prefilled(10);
    // The fixture asks about evenings only.
    expect(screen.getByText(EVENINGS)).toBeVisible();
  });

  it('leave the grid empty when nothing was offered before, or when it would paint nothing here', async () => {
    usualTimes.mockResolvedValue([]);
    const first = open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    first.unmount();

    usualTimes.mockResolvedValue(['weekday_morning']);
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
  });

  it('leave the grid empty, and the editor working, when the read fails', async () => {
    usualTimes.mockRejectedValue(new Error('offline'));
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
  });

  it('are read again when the editor opens again, so a new answer shows (review round 2)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    usualTimes.mockResolvedValue([]);
    const first = open(client);
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    first.unmount();

    // Another plan answered meanwhile: now there is something to start from.
    usualTimes.mockResolvedValue(['weekday_evening']);
    open(client);
    await prefilled(10);
  });

  it('stop starting the answer once the person has changed anything: clearing their last day is a choice (review round 1)', async () => {
    let release: (parts: string[]) => void = () => undefined;
    usualTimes.mockReturnValue(new Promise<string[]>((resolve) => (release = resolve)));
    open();
    await screen.findByText('Which evenings could work?');
    // They tap a day before the read comes back, then take it away again.
    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
    await act(async () => release(['weekday_evening']));
    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
    await act(async () => undefined);

    expect(tapped()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
  });

  it("start from this opening's read, not from what an earlier opening cached (review round 1)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, dailyStartMin: 9 * 60, dailyEndMin: 22 * 60 + 30 },
      answer: null,
    });
    usualTimes.mockResolvedValue(['weekday_evening']);
    const first = open(client);
    await prefilled(10);
    expect(screen.getByText(EVENINGS)).toBeVisible();
    first.unmount();

    // Since then they have offered afternoons instead, and the read says so.
    usualTimes.mockResolvedValue(['weekday_afternoon']);
    open(client);
    expect(await screen.findByText('Afternoons, 12–5 pm')).toBeVisible();
    expect(screen.queryByText(EVENINGS)).toBeNull();
  });

  it('say nothing was offered when the answer on file is a "none of these", which they leave alone (review round 4)', async () => {
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { status: 'none_work', windows: [], submittedAt: '2026-09-01T09:00:00Z' },
    });
    open();
    await screen.findByText('Which evenings could work?');
    await act(async () => undefined);
    expect(tapped()).toHaveLength(0);
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
  });

  it('never overwrite an answer already given', async () => {
    planToAnswer.mockResolvedValue(answerable);
    open();
    await screen.findByText(/, but /);
    await act(async () => undefined);
    // The stored answer's three days, not the ten weekdays.
    expect(tapped()).toHaveLength(3);
  });

  it('are never worded as "usual", anywhere on the screen', async () => {
    const { container } = open();
    await prefilled(10);
    expect(container.textContent).not.toMatch(/usual/i);
    expect(container.innerHTML).not.toMatch(/usual/i);
  });
});

describe('what the previous times are measured by', () => {
  it('says on the start whether it was offered, and on the send whether it began from it', async () => {
    open();
    await prefilled(10);
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: true,
      }),
    );

    // Edited afterwards, and still counted as begun from them.
    fireEvent.click(screen.getAllByRole('button', { name: /^Monday/ })[0]!);
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
    await screen.findByText('Which evenings could work?');
    expect(track).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id }),
    );
  });

  it('still counts an opening left before the read came back, without the flag', async () => {
    usualTimes.mockReturnValue(new Promise(() => undefined));
    const opened = open();
    await screen.findByText('Which evenings could work?');
    expect(track).not.toHaveBeenCalledWith('availability_started', expect.anything());
    opened.unmount();
    expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('carries no day-part in any event', async () => {
    usualTimes.mockResolvedValue(['weekday_evening', 'weekend_morning']);
    open();
    await prefilled(10);
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
    await tap(screen.findByRole('button', { name: /^Monday/ }));
    expect(screen.getByText(/^From now, from /)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Change the time for/ }));
    expect(await screen.findByRole('radio', { name: /^From now/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /^Later tonight/ })).toBeVisible();
    expect(screen.queryByRole('radio', { name: /^Evening/ })).toBeNull();
  });
});
