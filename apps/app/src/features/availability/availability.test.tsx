import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
let resend: (() => void) | undefined;
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
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
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;
const CODE = PLAN.code;
/** Monday 14 September, 6:30–10:30 pm in Melbourne. */
const MONDAY = { start: '2026-09-14T08:30:00.000Z', end: '2026-09-14T12:30:00.000Z' };
const WEDNESDAY = { start: '2026-09-16T09:00:00.000Z', end: '2026-09-16T11:30:00.000Z' };
const KEY = '5f0c7c3e-6b0e-4c8e-9a7a-0c7a1d2b3c4d';

function refusal(reason: string | undefined) {
  return new FunctionError(
    { error: 'conflict', ...(reason ? { reason } : {}), message: 'x', reference: 'R1' } as never,
    'x',
  );
}
const noAnswer = () => new FunctionError(undefined, 'submit-availability failed');
const stored = { response_id: 'r', revision: 1 };

function open(step: 'times' | 'none' = 'times') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AvailabilityFlow code={CODE} step={step} />
    </QueryClientProvider>,
  );
}

/** The date is in the runtime's locale ("Monday 14 September", "Monday September 14"). */
const mondayAt = (from: string, to: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Monday.*14.*, ${from} to ${to}$`) });

async function send() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
  });
}

beforeEach(() => {
  for (const mock of [replace, push, track, planToAnswer, submitAnswer, askToPlan]) {
    mock.mockReset();
  }
  resend = undefined;
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
  submitAnswer.mockResolvedValue(stored);
});

describe('painting and sending', () => {
  it('sends what was painted as one merged window, then shows Sent', async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(mondayAt('6:30', '7 pm'));
    fireEvent.click(mondayAt('7', '7:30 pm'));
    expect(screen.getByText('6:30–7:30 pm')).toBeInTheDocument();
    await send();

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: PLAN.id,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2026-09-14T08:30:00.000Z', end: '2026-09-14T09:30:00.000Z' }],
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
    expect(
      screen.getByText("Paint the times you'd be up for, or turn on I'm easy."),
    ).toBeInTheDocument();
  });

  it("sends I'm easy as flexible, with no windows, even with times painted underneath", async () => {
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(mondayAt('6:30', '7 pm'));
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
    expect(mondayAt('5:30', '6 pm')).toHaveAttribute('aria-checked', 'false');
    expect(mondayAt('6:30', '7 pm')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/of 14 days/)).toHaveTextContent('3 of 14 days');
  });
});

describe('while an answer is on its way', () => {
  it('cannot be changed, so what was sent is what the person last saw (round 1)', async () => {
    let arrive: (value: unknown) => void = () => undefined;
    submitAnswer.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(mondayAt('6:30', '7 pm'));
    await send();
    fireEvent.click(mondayAt('7', '7:30 pm'));
    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));

    expect(mondayAt('7', '7:30 pm')).toHaveAttribute('aria-checked', 'false');
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

    fireEvent.click(mondayAt('6:30', '7 pm'));
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

describe('when the server says no', () => {
  it('asks the new question when the plan changed under the answer', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('stale_revision'));
    open();
    await screen.findByText("Times I'd actually be up for");
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });

    fireEvent.click(mondayAt('6:30', '7 pm'));
    await send();

    await screen.findByText(/The plan changed/);
    expect(mondayAt('6:30', '7 pm')).toHaveAttribute('aria-checked', 'false');
  });

  it('says replies have closed when they have', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('replies_closed'));
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(mondayAt('6:30', '7 pm'));
    await send();

    await screen.findByText('Replies have closed for this one.');
  });

  it('asks the plan to include somebody who joined after it was made, then sends again', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('not_a_participant'));
    askToPlan.mockResolvedValue('asked');
    open();
    await screen.findByText("Times I'd actually be up for");

    fireEvent.click(mondayAt('6:30', '7 pm'));
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

    fireEvent.click(mondayAt('6:30', '7 pm'));
    await send();

    await screen.findByText("Something didn't save.");
    expect(screen.getByText('Ref R1')).toBeInTheDocument();
    expect(screen.getByText(/send Maya this reference/)).toBeInTheDocument();
    expect((await readDraft('priya', CODE))?.windows).toEqual([
      { start: '2026-09-14T08:30:00.000Z', end: '2026-09-14T09:00:00.000Z' },
    ]);
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
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, state: 'confirmed' }, answer: null });
    openLink();

    await screen.findByText('how it is looking');
  });
});
