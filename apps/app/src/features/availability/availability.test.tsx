import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * Answering a plan (spec §5.5, S1-25): what goes to `submit-availability`, and
 * what each answer back from it leads to. The grid's own arithmetic is
 * `editor.test.ts` and `days.test.ts`; the server's is S1-16's.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push, back: vi.fn(), canGoBack: () => false }),
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'priya', isAnonymous: true, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const planToAnswer = vi.fn();
const submitAnswer = vi.fn();
const othersSaid = vi.fn();
let resend: (() => void) | undefined;
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  othersSaid: (...args: unknown[]) => othersSaid(...args),
  // No usual times here: `usualTimes.test.tsx` is the pre-fill's.
  usualTimes: async () => undefined,
  onChanceToResend: (retry: () => void) => {
    resend = retry;
    return () => {
      resend = undefined;
    };
  },
}));
const askToPlan = vi.fn();
vi.mock('../../data/membership', () => ({ askToPlan: (...args: unknown[]) => askToPlan(...args) }));

const { AvailabilityFlow } = await import('./AvailabilityFlow');
const { PlanLinkFlow } = await import('./PlanLinkFlow');
const { FunctionError } = await import('../../data/functions');
const { readDraft, writeDraft } = await import('../../data/availability');
const { answerable, othersFirst, othersPartial } = await import('../../data/fixtures');

const PLAN = answerable.plan;
const CODE = PLAN.code;
/** Monday 14 September, 6:30–10:30 pm in Melbourne. */
const MONDAY = { start: '2099-09-14T08:30:00.000Z', end: '2099-09-14T12:30:00.000Z' };
const WEDNESDAY = { start: '2099-09-16T09:00:00.000Z', end: '2099-09-16T11:30:00.000Z' };
// Made at run time: a fixed key-shaped literal is what a secret scanner looks for.
const KEY = globalThis.crypto.randomUUID();

function refusal(reason: string | undefined) {
  return new FunctionError(
    { error: 'conflict', ...(reason ? { reason } : {}), message: 'x', reference: 'R1' } as never,
    'x',
  );
}
const noAnswer = () => new FunctionError(undefined, 'submit-availability failed');
const stored = { response_id: 'r', revision: 1 };

function open(step: 'times' | 'none' = 'times'): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AvailabilityFlow code={CODE} step={step} />
    </QueryClientProvider>,
  );
  return client;
}

/** The date is in the runtime's locale ("Monday 14 September", "Monday September 14"). */
const mondayAt = (from: string, to: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Monday.*14.*, ${from} to ${to}$`) });

/** A day in the grid, by weekday and date: "Tuesday 15 September, no times yet". */
const dayButton = (weekday: string, date: number) =>
  screen.getByRole('button', {
    name: new RegExp(`^${weekday}\\D*${date}(\\D[^,]*)?, (no times yet|[^.]*[ap]m)$`),
  });
const evening = () => screen.getByRole('checkbox', { name: /^Evening/ });

/** Monday's evening, by the grid and the Evening chip: the shortest answer there is. */
function answerMonday() {
  fireEvent.click(dayButton('Monday', 14));
  fireEvent.click(evening());
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}
/** Monday 14 September, 5:30–10:30 pm in Melbourne. */
/** The fixture's stored answer, as the editor sends it back. */
const STORED = (answerable.answer?.status === 'windows' ? answerable.answer.windows : []).map(
  (w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }),
);
const MONDAY_EVENING = { start: '2099-09-14T07:30:00.000Z', end: '2099-09-14T12:30:00.000Z' };

async function send() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
  });
}

beforeEach(() => {
  session.userId = 'priya';
  for (const mock of [replace, push, track, planToAnswer, submitAnswer, askToPlan]) {
    mock.mockReset();
  }
  resend = undefined;
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
  submitAnswer.mockResolvedValue(stored);
});

describe('painting and sending', () => {
  it('sends what was adjusted by the half hour as one merged window, then shows Sent', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    fireEvent.click(screen.getByRole('button', { name: /^Monday.*Adjust by the half hour$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Clear Monday/ }));
    fireEvent.click(mondayAt('6:30', '7 pm'));
    fireEvent.click(mondayAt('7', '7:30 pm'));
    expect(screen.getByText('6:30–7:30 pm')).toBeInTheDocument();
    await send();

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: PLAN.id,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-09-14T08:30:00.000Z', end: '2099-09-14T09:30:00.000Z' }],
      }),
    );
    expect(replace).toHaveBeenCalledWith({ pathname: '/j/[code]/sent', params: { code: CODE } });
    expect(track).toHaveBeenCalledWith('availability_submitted', {
      plan_id: PLAN.id,
      status: 'windows',
      window_count: 1,
    });
    // Sent, so nothing is left waiting on the device.
    expect(await readDraft('priya', CODE)).toBeUndefined();
  });

  it('counts opening it as starting, with the plan, for the time-to-answer median', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id });
  });

  it('will not send an empty answer, and says what would make it one', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    expect(screen.getByText("Pick some days and a time, or turn on I'm easy.")).toBeInTheDocument();
  });

  it("sends I'm easy as flexible, with no windows, even with times painted underneath", async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));
    await send();

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'flexible', windows: [] }),
    );
  });

  it('reopens the stored answer as it was painted', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();

    await screen.findByText('6:30–10:30 pm');
    // The same days, tags and ranges as were given.
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 6:30–10:30 pm$/);
    expect(dayButton('Monday', 14)).toHaveTextContent('Some');
    expect(dayButton('Wednesday', 16)).toHaveAccessibleName(/, 7–9:30 pm$/);
    expect(dayButton('Thursday', 17)).toHaveTextContent('Eve');
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, no times yet$/);
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('3 of 14 days');

    fireEvent.click(screen.getByRole('button', { name: /^Monday.*Adjust by the half hour$/ }));
    expect(mondayAt('5:30', '6 pm')).toHaveAttribute('aria-checked', 'false');
    expect(mondayAt('6:30', '7 pm')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('days first, then a time once (ADR 0024)', () => {
  it('answers "Tue, Thu and Sat evenings" in five taps: three days, Evening, Send', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(dayButton('Thursday', 17));
    fireEvent.click(dayButton('Saturday', 19));
    fireEvent.click(evening());
    await send();

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'windows',
        windows: [15, 17, 19].map((date) => ({
          start: `2099-09-${date}T07:30:00.000Z`,
          end: `2099-09-${date}T12:30:00.000Z`,
        })),
      }),
    );
  });

  it('keeps which days are ticked and which is open off the device and out of the request', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(dayButton('Thursday', 17));
    // Ticking sets no time, so there is nothing to keep yet.
    await act(async () => undefined);
    expect(await readDraft('priya', CODE)).toBeUndefined();

    fireEvent.click(evening());
    fireEvent.click(screen.getByRole('button', { name: /^Tuesday.*Adjust by the half hour$/ }));
    await waitFor(async () => expect(await readDraft('priya', CODE)).toBeDefined());
    const stored = JSON.stringify(globalThis.localStorage);
    expect(stored).not.toMatch(/ticked|"open"|undo/);

    await send();
    expect(Object.keys(submitAnswer.mock.calls[0]![0]).sort()).toEqual([
      'idempotencyKey',
      'planId',
      'revision',
      'status',
      'windows',
    ]);
  });

  it('says what a tick and a block did, on the day and in the answer', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    expect(
      screen.getByText('Tap every day that could work. Then pick a time once, for all of them.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nothing yet. Your days and times will be listed here in words.'),
    ).toBeInTheDocument();

    fireEvent.click(dayButton('Tuesday', 15));
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-pressed', 'true');
    expect(evening()).toHaveAccessibleName('Evening, 5:30–10:30 pm');
    expect(evening()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(evening());
    expect(evening()).toHaveAttribute('aria-checked', 'true');
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(dayButton('Tuesday', 15)).toHaveTextContent('Eve');
    // On the chip, and as the answer in words.
    expect(screen.getAllByText('5:30–10:30 pm')).toHaveLength(2);
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('1 of 14 days');
  });

  it('adjusts one day by the half hour, one day open at a time', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();
    await screen.findByText('6:30–10:30 pm');
    expect(screen.queryAllByRole('checkbox', { name: / to / })).toHaveLength(0);

    const mondayLine = () =>
      screen.getByRole('button', { name: /^Monday.*Adjust by the half hour$/ });
    fireEvent.click(mondayLine());
    expect(mondayLine()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(mondayAt('5:30', '6 pm'));
    expect(screen.getByText('5:30–10:30 pm', { selector: 'div' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Wednesday.*Adjust by the half hour$/ }));
    expect(mondayLine()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('checkbox', { name: /^Monday.* to / })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^Remove Wednesday/ }));
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('2 of 14 days');
  });

  it('starts over, and Undo gives back exactly the answer that was there', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();
    await screen.findByText('6:30–10:30 pm');

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('0 of 14 days');
    expect(screen.getByText('Cleared.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('3 of 14 days');
    expect(screen.queryByText('Cleared.')).toBeNull();
    await send();
    expect(submitAnswer.mock.calls[0]![0].windows).toEqual(STORED);
  });

  it("dims the days under I'm easy and gives them back when it is turned off", async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();
    await screen.findByText('6:30–10:30 pm');

    fireEvent.click(screen.getByRole('button', { name: /^Monday.*Adjust by the half hour$/ }));
    fireEvent.click(dayButton('Wednesday', 16));
    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-disabled', 'true');
    // The panel's chips say they are out of play, and are (round 2).
    expect(screen.getByRole('checkbox', { name: /^Evening/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /^Evening/ }));
    expect(screen.getByRole('checkbox', { name: /^Evening/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // The open day stays where it was, faded, rather than folding away.
    expect(mondayAt('6:30', '7 pm')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(mondayAt('6:30', '7 pm'));
    expect(mondayAt('6:30', '7 pm')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(dayButton('Tuesday', 15));
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));
    await send();
    expect(submitAnswer.mock.calls[0]![0]).toMatchObject({ status: 'windows', windows: STORED });
  });
});

describe('while an answer is on its way', () => {
  it('cannot be changed, so what was sent is what the person last saw (round 1)', async () => {
    let arrive: (value: unknown) => void = () => undefined;
    submitAnswer.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();
    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));

    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('switch', { name: "I'm easy" })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await act(async () => arrive(stored));
  });
});

describe('a connection that goes nowhere', () => {
  it('keeps the times on the device and sends the same request when it can', async () => {
    submitAnswer.mockRejectedValueOnce(noAnswer());
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();

    await screen.findByText('Your times are saved on this phone.');
    const draft = await readDraft('priya', CODE);
    expect(draft?.pending?.status).toBe('windows');
    const firstKey = submitAnswer.mock.calls[0]![0].idempotencyKey;

    await act(async () => {
      resend?.();
    });

    await waitFor(() => expect(replace).toHaveBeenCalled());
    // The resend *is* the first send: one answer, whatever reached the server.
    expect(submitAnswer.mock.calls[1]![0].idempotencyKey).toBe(firstKey);
  });

  it('sends a draft that was on its way when the page went away, as soon as the page is back', async () => {
    await writeDraft('priya', CODE, {
      plan: PLAN,
      windows: [MONDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });
    open();

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: KEY,
      windows: [MONDAY],
    });
  });

  it('shows the plan from the device when the plan cannot be fetched', async () => {
    await writeDraft('priya', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    planToAnswer.mockRejectedValue(new Error('plan lookup failed'));
    open();

    await screen.findByText('7–9:30 pm');
  });
});

describe('what the device had, against what the server has', () => {
  it('prefers a draft newer than the stored answer: it is what the person last did', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    await writeDraft('priya', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    open();

    await screen.findByText('7–9:30 pm');
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('1 of 14 days');
  });

  it('throws away a draft of a question that has since changed, and says so', async () => {
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });
    await writeDraft('priya', CODE, { plan: PLAN, windows: [MONDAY], flexible: false });
    open();

    await screen.findByText(/The plan changed/);
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('0 of 14 days');
    await waitFor(async () => expect(await readDraft('priya', CODE)).toBeUndefined());
  });
});

describe('round 2', () => {
  it('shows replies closed for a plan past its deadline, however it is still marked', async () => {
    // A plan stays collecting after its deadline so the organiser can still
    // decide (spec §8); it is not asking anybody any more. The server judged
    // the deadline (round 6).
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, state: 'collecting', acceptingAnswers: false },
      answer: null,
    });
    open();

    await screen.findByText('Replies have closed for this one.');
  });

  it('resends a send in flight even when the server answer is newer than the draft', async () => {
    // The send committed and its reply was lost: the stored answer is later
    // than the draft, and only resending (a replay) clears the draft.
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { ...answerable.answer, submittedAt: '2999-01-01T00:00:00Z' },
    });
    await writeDraft('priya', CODE, {
      plan: PLAN,
      windows: [WEDNESDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });
    open();

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0]![0]).toMatchObject({ idempotencyKey: KEY });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('asks the plan again on the next resend when asking failed the first time', async () => {
    submitAnswer.mockRejectedValue(refusal('not_a_participant'));
    askToPlan.mockResolvedValue('failed');
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();
    await screen.findByText('Your times are saved on this phone.');
    await act(async () => {
      resend?.();
    });

    await waitFor(() => expect(askToPlan).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Something didn't save.")).toBeNull();
  });
});

describe('round 3', () => {
  it('waits for the server before letting an unsent draft win over an answer given since', async () => {
    let answerNow: (value: unknown) => void = () => undefined;
    planToAnswer.mockReturnValue(new Promise((resolve) => (answerNow = resolve)));
    await writeDraft('priya', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    open();
    // The device's draft is read first; the server is slower.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The server's answer, given later on another device: Monday, not Wednesday.
    await act(async () =>
      answerNow({
        plan: PLAN,
        answer: { status: 'windows', windows: [MONDAY], submittedAt: '2999-01-01T00:00:00Z' },
      }),
    );

    await screen.findByText('6:30–10:30 pm');
    expect(screen.queryByText('7–9:30 pm')).toBeNull();
  });
});

describe('round 4', () => {
  it('asks the new question when a draft shown from the device meets a changed plan', async () => {
    planToAnswer.mockRejectedValueOnce(new Error('plan lookup failed'));
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });
    submitAnswer.mockRejectedValueOnce(refusal('stale_revision'));
    await writeDraft('priya', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    open();
    await screen.findByText('7–9:30 pm');

    await send();

    await screen.findByText(/The plan changed/);
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    expect(screen.queryByText('Sending')).toBeNull();
  });
});

describe('round 5', () => {
  it("never shows or sends one person's draft to the next person on the same page", async () => {
    planToAnswer.mockReturnValue(new Promise(() => undefined));
    submitAnswer.mockReturnValue(new Promise(() => undefined));
    await writeDraft('priya', CODE, {
      plan: PLAN,
      windows: [WEDNESDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = () => (
      <QueryClientProvider client={client}>
        <AvailabilityFlow code={CODE} step="times" />
      </QueryClientProvider>
    );
    const { rerender } = render(page());
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledTimes(1));

    // Priya signs out on a shared browser; Tom signs in, and the page stays.
    session.userId = 'tom';
    rerender(page());

    expect(screen.queryByText('7–9:30 pm')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByText('7–9:30 pm')).toBeNull();
    expect(submitAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('round 6', () => {
  it("takes the server's word that replies are open, whatever this device's clock says", async () => {
    // A phone whose clock runs fast would put the deadline behind it.
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, responseDeadline: '2000-01-01T00:00:00Z', acceptingAnswers: true },
      answer: null,
    });
    open();

    await screen.findByText("Times I'd actually be up for");
  });
});

describe('when the server says no', () => {
  it('asks the new question when the plan changed under the answer', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('stale_revision'));
    open();
    await screen.findByText("Times I'd actually be up for");
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });

    answerMonday();
    await send();

    await screen.findByText(/The plan changed/);
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, no times yet$/);
  });

  it('fetches the plan again, keeping the times, when days were taken away while it was open (ADR 00ZZ)', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('outside_plan_window'));
    open();
    await screen.findByText("Times I'd actually be up for");
    // The organiser took Tuesday 15 away, which nobody had picked: the same
    // revision, one day fewer.
    const days = Array.from({ length: 14 }, (_, i) => `2099-09-${String(14 + i).padStart(2, '0')}`);
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, days: days.filter((day) => day !== '2099-09-15') },
      answer: null,
    });

    answerMonday();
    await send();

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Tuesday\D*15/ })).toBeNull());
    expect(screen.queryByText(/The plan changed/)).toBeNull();
    // Monday's evening, painted before the send, is still there to send again.
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
  });

  it('keeps unsent times when days are taken away and the plan is read again (ADR 00ZZ, round 2)', async () => {
    const client = open();
    await screen.findByText("Times I'd actually be up for");
    answerMonday();
    // Written to the device as it is painted, and not sent.
    await waitFor(async () => expect((await readDraft('priya', CODE))?.windows).toHaveLength(1));
    const days = Array.from({ length: 14 }, (_, i) => `2099-09-${String(14 + i).padStart(2, '0')}`);
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, days: days.filter((day) => day !== '2099-09-15') },
      answer: null,
    });

    // A refetch, as on focus: no send was made.
    await act(async () => client.invalidateQueries());

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Tuesday\D*15/ })).toBeNull());
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
  });

  it('says replies have closed when they have', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('replies_closed'));
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();

    await screen.findByText('Replies have closed for this one.');
  });

  it('asks the plan to include somebody who joined after it was made, then sends again', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('not_a_participant'));
    askToPlan.mockResolvedValue('asked');
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(askToPlan).toHaveBeenCalledWith(CODE);
    expect(submitAnswer.mock.calls[1]![0].idempotencyKey).toBe(
      submitAnswer.mock.calls[0]![0].idempotencyKey,
    );
  });

  it('gives a reference to quote when something else went wrong, and keeps the times', async () => {
    submitAnswer.mockRejectedValueOnce(refusal(undefined));
    open();
    await screen.findByText("Times I'd actually be up for");

    answerMonday();
    await send();

    await screen.findByText("Something didn't save.");
    expect(screen.getByText('Ref R1')).toBeInTheDocument();
    expect(screen.getByText(/send Maya this reference/)).toBeInTheDocument();
    expect((await readDraft('priya', CODE))?.windows).toEqual([MONDAY_EVENING]);
  });
});

describe('none of these dates', () => {
  it.each([
    ["I'm keen, just not these dates", 'none_work'],
    ['Not enough notice', 'more_notice'],
    ['Not this time', 'not_this_time'],
  ])('"%s" sends %s, with no windows', async (label, status) => {
    open('none');

    const option = await screen.findByRole('button', { name: label });
    await act(async () => {
      fireEvent.click(option);
    });

    expect(submitAnswer).toHaveBeenCalledWith(expect.objectContaining({ status, windows: [] }));
    expect(track).toHaveBeenCalledWith('availability_submitted', {
      plan_id: PLAN.id,
      status,
      window_count: 0,
    });
  });

  it('names the organiser as the person who sees "keen"', async () => {
    open('none');

    await screen.findByText(
      "Maya sees you'd like to come. If the window changes, you'll be asked again.",
    );
  });
});

describe("the plan's own link, /p/:code", () => {
  function openLink() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlanLinkFlow code={CODE}>
          <p>how it is looking</p>
        </PlanLinkFlow>
      </QueryClientProvider>,
    );
  }

  it('is the editor for a member who has not answered a plan that is still asking', async () => {
    openLink();

    await screen.findByText("Times I'd actually be up for");
    expect(screen.queryByText('how it is looking')).toBeNull();
  });

  it('is the editor for somebody whose changed answer is still waiting on the device (round 1)', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    await writeDraft('priya', CODE, {
      plan: PLAN,
      windows: [WEDNESDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });
    openLink();

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0]![0]).toMatchObject({ windows: [WEDNESDAY] });
    expect(screen.queryByText('how it is looking')).toBeNull();
  });

  it('is the plan page for somebody who has answered', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    openLink();

    await screen.findByText('how it is looking');
  });

  it('is the plan page when the draft on the device is older than the answer given since', async () => {
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { ...answerable.answer, submittedAt: '2999-01-01T00:00:00Z' },
    });
    await writeDraft('priya', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    openLink();

    await screen.findByText('how it is looking');
  });

  it('is the plan page once the plan has stopped asking', async () => {
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, state: 'confirmed', acceptingAnswers: false },
      answer: null,
    });
    openLink();

    await screen.findByText('how it is looking');
  });
});

describe('an answer an edit cleared, with nothing on the device (SUS-130)', () => {
  const REVISED = { ...PLAN, revision: 2 };

  it('says the plan changed when the server has an earlier answer and none to this question', async () => {
    planToAnswer.mockResolvedValue({ plan: REVISED, answer: null, answeredEarlierRevision: true });
    open();

    await screen.findByText(/The plan changed/);
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('0 of 14 days');
  });

  it('says nothing of the kind to somebody who never answered an earlier question', async () => {
    planToAnswer.mockResolvedValue({ plan: REVISED, answer: null, answeredEarlierRevision: false });
    open();

    await screen.findByText("Times I'd actually be up for");
    expect(screen.queryByText(/The plan changed/)).toBeNull();
  });

  it('stops saying it once they have answered the question as it is now', async () => {
    planToAnswer.mockResolvedValue({
      plan: REVISED,
      answer: answerable.answer,
      answeredEarlierRevision: true,
    });
    open();

    await screen.findByText("Times I'd actually be up for");
    expect(screen.queryByText(/The plan changed/)).toBeNull();
  });
});

describe('what the others have said (SUS-129)', () => {
  afterEach(() => othersSaid.mockReset());

  it('shows the counts it reads, in words, and sends exactly the answer it would without them', async () => {
    othersSaid.mockResolvedValue(othersPartial);
    open();
    expect(
      await screen.findByText(
        '4 of the other 5 have answered. The number on each day is how many of them could make it.',
      ),
    ).toBeInTheDocument();
    expect(othersSaid).toHaveBeenCalledWith(PLAN.id);
    expect(
      screen.getByRole('button', { name: /^Thursday\D*17.*, 4 others could make it$/ }),
    ).toBeInTheDocument();

    answerMonday();
    expect(screen.getByText('No overlap with anyone yet')).toBeInTheDocument();
    await send();
    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'windows', windows: [MONDAY_EVENING] }),
    );
    expect(track).toHaveBeenCalledWith('availability_others_read', {
      plan_id: PLAN.id,
      others_shown: true,
    });
  });

  it('keeps the counts out of the draft on the device', async () => {
    othersSaid.mockResolvedValue(othersPartial);
    open();
    await screen.findByText(/^4 of the other 5 have answered\./);
    answerMonday();
    await waitFor(async () => expect(await readDraft('priya', CODE)).toBeDefined());
    const draft = JSON.stringify(await readDraft('priya', CODE));
    expect(draft).not.toMatch(/answered|others|withTimes|flexible"?:\s*\d/);
  });

  it('says the reader is first, and shows no counts, below the threshold', async () => {
    othersSaid.mockResolvedValue(othersFirst);
    open();
    expect(await screen.findByText(/^You're the first to answer\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /could make it$/ })).toBeNull();
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_others_read', {
        plan_id: PLAN.id,
        others_shown: false,
      }),
    );
  });

  it('sends the start as the editor opens, however long the read of the others takes (review round 2)', async () => {
    othersSaid.mockReturnValue(new Promise(() => undefined));
    open();
    await screen.findByText("Times I'd actually be up for");
    expect(track).toHaveBeenCalledWith('availability_started', { plan_id: PLAN.id });
    expect(track).not.toHaveBeenCalledWith('availability_others_read', expect.anything());
  });

  it("shows nothing from an earlier opening when this opening's read fails (review round 1)", async () => {
    // One client for both openings, as in the app: the cache outlives the
    // editor, and an earlier read must not stand in for a failed one.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const editor = () => (
      <QueryClientProvider client={client}>
        <AvailabilityFlow code={CODE} step="times" />
      </QueryClientProvider>
    );
    othersSaid.mockResolvedValue(othersPartial);
    const first = render(editor());
    await screen.findByText(/^4 of the other 5 have answered\./);
    first.unmount();

    othersSaid.mockReset();
    othersSaid.mockRejectedValue(new Error('offline'));
    track.mockReset();
    render(editor());
    await screen.findByText("Times I'd actually be up for");
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_others_read', {
        plan_id: PLAN.id,
        others_shown: false,
      }),
    );
    expect(screen.queryByText(/have answered\./)).toBeNull();
    expect(screen.queryByRole('button', { name: /could make it$/ })).toBeNull();
  });

  it('leaves the editor as it was when the read fails, and the answer still goes', async () => {
    othersSaid.mockRejectedValue(new Error('offline'));
    open();
    await screen.findByText("Times I'd actually be up for");
    await waitFor(() => expect(othersSaid).toHaveBeenCalled());
    expect(screen.queryByText(/have answered\./)).toBeNull();
    expect(screen.queryByText(/first to answer/)).toBeNull();

    answerMonday();
    expect(screen.queryByText(/overlap/i)).toBeNull();
    await send();
    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'windows', windows: [MONDAY_EVENING] }),
    );
  });
});
