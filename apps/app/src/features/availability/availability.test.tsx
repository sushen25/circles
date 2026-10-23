import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tap } from '../../test/tap';

import type * as AvailabilityData from '../../data/availability';

/**
 * Answering a plan (spec §5.5, S1-25): what goes to `submit-availability`, and
 * what each answer back from it leads to. The grid's own arithmetic is
 * `editor.test.ts` and `days.test.ts`; the server's is S1-16's.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock('expo-router', async () => {
  const { answerRouter } = await import('../../test/answer-router');
  return answerRouter({ replace: (h) => replace(h), push: (h) => push(h) });
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'nina', isAnonymous: true, isLoading: false };
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
  // No usual times here: `usualTimes.test.tsx` is the usual days'.
  usualTimes: async () => [],
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
/** The call never left the device: `invokeFunction` marks a fetch that threw (SUS-200). */
const noAnswer = () => new FunctionError(undefined, 'submit-availability failed', true);
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

/** A day's From or To button ("From 5:30 pm, Monday 14 September"), by what it says now. */
const timeButton = (which: 'from' | 'to', weekday: string, time: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^${which === 'from' ? 'From' : 'To'} ${time}, ${weekday}`),
  });
/** Opens that button's picker and chooses a time from it. */
const pick = (which: 'from' | 'to', weekday: string, now: string, time: string) => {
  fireEvent.click(timeButton(which, weekday, now));
  fireEvent.click(screen.getByRole('radio', { name: time }));
};

/** A day in the grid, by weekday and date: "Tuesday 15 September", then its times once tapped. */
const dayButton = (weekday: string, date: number) =>
  screen.getByRole('button', {
    name: new RegExp(`^${weekday}\\D*${date}(\\D|$)`),
  });
const evening = () => screen.getByRole('radio', { name: /^Evening/ });
/** A tapped day's row on "A time for each day", by the weekday. */
const dayRow = (weekday: string) => screen.getByRole('group', { name: new RegExp(`^${weekday}`) });
/** The same plan, asking about the whole day: Evening, Daytime and Any time are real choices. */
const WHOLE = { ...PLAN, dailyStartMin: 9 * 60, dailyEndMin: 22 * 60 + 30 };

/** Monday's evening, by one tap on the grid: the shortest answer there is. */
function answerMonday() {
  fireEvent.click(dayButton('Monday', 14));
}

/**
 * From the answer block to "A time for each day": "Not the same every day?",
 * or "Adjust hours" on a plan with one window. (Days that already differ open
 * on the list: there is nothing to press.)
 */
function eachDay() {
  const link = screen.queryByRole('button', { name: /^(Not the same every day\?|Adjust hours)$/ });
  if (link !== null) fireEvent.click(link);
}
/** A day's own half hours, on the sheet its clock opens. */
const byTheHalfHour = (weekday: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Exact hours, ${weekday}`) }));
/** The list's heading, which says the days differ (or that the list is open). */
const differing = () =>
  screen.findByRole('heading', { name: /^(A time for each day|Your hours each evening)$/ });
/** Done on the day's sheet. */
function backToAnswer() {
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
  session.userId = 'nina';
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
    await screen.findByText('Which evenings could work?');

    answerMonday();
    // 6:30–10 pm: From moves to 6:30 and To to 10:00.
    eachDay();
    byTheHalfHour('Monday');
    pick('from', 'Monday', '5:30 pm', '6:30 pm');
    pick('to', 'Monday', '10:30 pm', '10:00 pm');
    expect(screen.getAllByText('6:30–10 pm').length).toBeGreaterThan(0);
    backToAnswer();
    // The sheet is gone and the day says its hours, in its row.
    expect(screen.queryByRole('button', { name: /^From \d/ })).toBeNull();
    expect(screen.getByText('6:30–10 pm')).toBeInTheDocument();
    await send();

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: PLAN.id,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-09-14T08:30:00.000Z', end: '2099-09-14T12:00:00.000Z' }],
      }),
    );
    expect(replace).toHaveBeenCalledWith({ pathname: '/j/[code]/sent', params: { code: CODE } });
    expect(track).toHaveBeenCalledWith('availability_submitted', {
      plan_id: PLAN.id,
      status: 'windows',
      window_count: 1,
      usual_used: false,
    });
    // Sent, so nothing is left waiting on the device.
    expect(await readDraft('nina', CODE)).toBeUndefined();
  });

  it('counts opening it as starting, with the plan, for the time-to-answer median', async () => {
    open();
    await screen.findByText('Which evenings could work?');

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
  });

  it('will not send an empty answer, and says what would make it one', async () => {
    open();
    await screen.findByText('Which evenings could work?');

    expect(screen.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    // The guidance line is what says why: tap a day. There is no answer block yet.
    expect(screen.getByText('Tap or drag across the evenings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust hours' })).toBeNull();
    // Pressed anyway, it says why instead of doing nothing (SUS-250).
    expect(screen.queryByText('Tap at least one evening first.')).toBeNull();
    fireEvent.click(screen.getByTestId('waiting-press'));
    expect(screen.getByText('Tap at least one evening first.')).toBeInTheDocument();
    expect(submitAnswer).not.toHaveBeenCalled();
    fireEvent.click(dayButton('Monday', 14));
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeEnabled();
    expect(screen.queryByText('Tap at least one evening first.')).toBeNull();
  });

  it("sends I'm easy as flexible, with no windows, even with times painted underneath", async () => {
    open();
    await screen.findByText('Which evenings could work?');

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

    await differing();
    // The same days and ranges as were given, on the days and in one line.
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 6:30–10:30 pm$/);
    expect(dayButton('Wednesday', 16)).toHaveAccessibleName(/, 7–9:30 pm$/);
    expect(dayButton('Thursday', 17)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(dayButton('Tuesday', 15)).not.toHaveAccessibleName(/pm/);
    expect(dayButton('Monday', 14)).toHaveAttribute('aria-pressed', 'true');
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-pressed', 'false');

    // Days that differ: the block opens as a time for each day.
    expect(screen.getByRole('heading', { name: 'Your hours each evening' })).toBeInTheDocument();
    expect(screen.getAllByText('6:30–10:30 pm').length).toBeGreaterThan(0);
    byTheHalfHour('Monday');
    expect(timeButton('from', 'Monday', '6:30 pm')).toBeInTheDocument();
    expect(timeButton('to', 'Monday', '10:30 pm')).toBeInTheDocument();
  });
});

describe('the list and the sheet are parts of the first screen (SUS-236)', () => {
  it('goes Back to Evening from a one-window day too, without touching the other days', async () => {
    open();
    await screen.findByText('Which evenings could work?');
    fireEvent.click(dayButton('Monday', 14));
    fireEvent.click(dayButton('Tuesday', 15));
    eachDay();

    byTheHalfHour('Monday');
    pick('to', 'Monday', '10:30 pm', '9:00 pm');
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 5:30–9 pm$/);
    await tap(screen.getByRole('button', { name: 'Back to Evening instead' }));
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
  });

  it('open and close in place: the address does not change and Back leaves the page', async () => {
    open();
    await screen.findByText('Which evenings could work?');
    answerMonday();

    eachDay();
    expect(screen.getByRole('heading', { name: 'Your hours each evening' })).toBeInTheDocument();
    byTheHalfHour('Monday');
    expect(timeButton('from', 'Monday', '5:30 pm')).toBeInTheDocument();
    backToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Same for every day' }));

    // Still the first screen, with the answer as it was.
    expect(screen.getByText('Which evenings could work?')).toBeInTheDocument();
    expect(dayButton('Monday', 14)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Adjust hours' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('days first, then a time once (ADR 0068)', () => {
  it('answers "Tue, Thu and Sat evenings" in four taps: three days, then Send', async () => {
    open();
    await screen.findByText('Which evenings could work?');

    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(dayButton('Thursday', 17));
    fireEvent.click(dayButton('Saturday', 19));
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

  it('sends the same replace_response payload as the editor before it did for the same answer (ADR 0013)', async () => {
    // What the editor before this one sent for "Monday, 5:30–10:30 pm": one
    // window for the day, status windows, this revision, a fresh key.
    const before = {
      planId: PLAN.id,
      revision: 1,
      status: 'windows',
      windows: [MONDAY_EVENING],
    };

    const tapped = open();
    await screen.findByText('Which evenings could work?');
    answerMonday();
    await send();
    const { idempotencyKey, ...byTapping } = submitAnswer.mock.calls[0]![0];
    expect(byTapping).toEqual(before);
    expect(idempotencyKey).toEqual(expect.any(String));
    tapped.unmount();
    cleanup();

    // And the same answer reopened from the server and sent unchanged.
    submitAnswer.mockClear();
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { status: 'windows', windows: [MONDAY_EVENING], submittedAt: '2000-01-01T00:00:00Z' },
    });
    open();
    await screen.findByText('From 5:30 pm');
    await send();
    const { idempotencyKey: sentKey, ...byReopening } = submitAnswer.mock.calls[0]![0];
    expect(byReopening).toEqual(before);
    expect(sentKey).toEqual(expect.any(String));
  });

  it('keeps which day is open and the shared time off the device and out of the request', async () => {
    open();
    await screen.findByText('Which evenings could work?');

    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(dayButton('Thursday', 17));
    // A tapped day has a time, so it is an answer and a draft is kept.
    await waitFor(async () => expect(await readDraft('nina', CODE)).toBeDefined());

    eachDay();
    byTheHalfHour('Tuesday');
    const stored = JSON.stringify(globalThis.localStorage);
    expect(stored).not.toMatch(/ticked|"open"|undo|"window"/);

    backToAnswer();
    await send();
    expect(Object.keys(submitAnswer.mock.calls[0]![0]).sort()).toEqual([
      'idempotencyKey',
      'planId',
      'revision',
      'status',
      'windows',
    ]);
  });

  it('says what a tap did, on the day and in the answer block', async () => {
    open();
    await screen.findByText('Which evenings could work?');

    expect(screen.getByText('Tap or drag across the evenings.')).toBeInTheDocument();
    expect(screen.getByText('Replies close', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('My answer')).toBeNull();
    // Nothing to explain until a day is tapped: no block, no heading.
    expect(screen.queryByRole('heading', { name: 'Your hours each evening' })).toBeNull();

    fireEvent.click(dayButton('Tuesday', 15));
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-pressed', 'true');
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(screen.getByRole('heading', { name: 'Your hours each evening' })).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('From 5:30 pm')).toBeInTheDocument();
    // No day list, no per-day rows, no Change time: the grid says which days.
    expect(screen.queryByText(/Tue 15/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Exact hours/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change time/ })).toBeNull();

    // The plan leaves one window, so there is nothing to pick: no pills, and the
    // link is "Adjust hours", which opens the list of days.
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust hours' }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your hours each evening' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Exact hours, Tuesday/ })).toBeInTheDocument();
  });

  it('offers Evening, Daytime and Any time, and applies the pick to every tapped day, on a whole-day plan', async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: null });
    open();
    await screen.findByText('Which days could work?');
    expect(screen.getByText('Tap or drag across the days.')).toBeInTheDocument();
    // No block until a day is tapped.
    expect(screen.queryByRole('radiogroup')).toBeNull();

    fireEvent.click(dayButton('Tuesday', 15));
    fireEvent.click(dayButton('Thursday', 17));
    expect(screen.getByRole('heading', { name: 'When, on those days?' })).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.getByText('From 5:30 pm')).toBeInTheDocument();
    expect(evening()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Daytime' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Daytime' }));
    expect(screen.getByText('9 am–5 pm')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Daytime' })).toHaveAttribute('aria-checked', 'true');
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, 9 am–5 pm$/);
    expect(dayButton('Thursday', 17)).toHaveAccessibleName(/, 9 am–5 pm$/);
  });

  it('hides the heading, pills and hours for a time for each day, and brings them back with Same for every day', async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: null });
    open();
    await screen.findByText('Which days could work?');
    await tap(dayButton('Thursday', 17));
    await tap(dayButton('Tuesday', 15));
    await tap(screen.getByRole('radio', { name: 'Daytime' }));

    eachDay();
    expect(screen.queryByRole('heading', { name: 'When, on those days?' })).toBeNull();
    expect(screen.queryByText('9 am–5 pm')).toBeNull();
    expect(screen.getByRole('heading', { name: 'A time for each day' })).toBeInTheDocument();
    // One row for each day, in date order, each with its current choice.
    expect(
      screen
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label') ?? '')
        .filter((label) => /^(Tuesday|Thursday)/.test(label)),
    ).toHaveLength(2);
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Tuesday/),
        expect.stringMatching(/^Thursday/),
      ]),
    );
    expect(within(dayRow('Tuesday')).getByRole('radio', { name: 'Daytime' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // A row's pill changes that day only.
    await tap(within(dayRow('Thursday')).getByRole('radio', { name: 'Any time' }));
    expect(within(dayRow('Thursday')).getByRole('radio', { name: 'Any time' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(dayButton('Tuesday', 15)).toHaveAccessibleName(/, 9 am–5 pm$/);

    // Same for every day: the list collapses on the last shared choice.
    await tap(screen.getByRole('button', { name: 'Same for every day' }));
    expect(screen.getByRole('heading', { name: 'When, on those days?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Daytime' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('9 am–5 pm')).toBeInTheDocument();
    expect(dayButton('Thursday', 17)).toHaveAccessibleName(/, 9 am–5 pm$/);
  });

  it("opens a day's clock as a sheet, lights the clock after Done, and goes Back to the choice it had", async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: null });
    open();
    await screen.findByText('Which days could work?');
    await tap(dayButton('Tuesday', 15));
    await tap(dayButton('Thursday', 17));
    eachDay();

    byTheHalfHour('Tuesday');
    expect(
      screen.getByText("Set the hours you'd be up for. Add a second time if there's a gap."),
    ).toBeInTheDocument();
    pick('from', 'Tuesday', '5:30 pm', '6:00 pm');
    backToAnswer();
    // The sheet is gone; the row says its hours and has no choice selected.
    expect(screen.queryByRole('button', { name: /^From \d/ })).toBeNull();
    expect(within(dayRow('Tuesday')).getByText('6–10:30 pm')).toBeInTheDocument();
    expect(
      within(dayRow('Tuesday'))
        .getAllByRole('radio')
        .every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true);

    // Thursday, still Evening: its sheet says how to go back, and does.
    byTheHalfHour('Thursday');
    pick('to', 'Thursday', '10:30 pm', '9:00 pm');
    await tap(screen.getByRole('button', { name: 'Back to Evening instead' }));
    expect(within(dayRow('Thursday')).getByRole('radio', { name: 'Evening' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(dayButton('Thursday', 17)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(screen.queryByRole('button', { name: /^From \d/ })).toBeNull();

    // A day that had hours of its own has no choice to go back to.
    byTheHalfHour('Tuesday');
    expect(screen.queryByRole('button', { name: /^Back to .* instead$/ })).toBeNull();
  });

  it("opens one day's half hours at a time, and a choice sets one day alone", async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: answerable.answer });
    open();
    await screen.findByText('Which days could work?');
    // The days differ, so the block is already the list.
    await differing();
    expect(screen.queryAllByRole('button', { name: /^From \d/ })).toHaveLength(0);

    byTheHalfHour('Monday');
    pick('from', 'Monday', '6:30 pm', '5:30 pm');
    backToAnswer();
    // Monday's hours are now exactly the evening, as Thursday's already were.
    expect(within(dayRow('Monday')).getByRole('radio', { name: 'Evening' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryAllByRole('button', { name: /^From \d/ })).toHaveLength(0);

    // Wednesday's own hours become the evening; Monday's are left as they were.
    fireEvent.click(within(dayRow('Wednesday')).getByRole('radio', { name: 'Evening' }));
    expect(within(dayRow('Wednesday')).getByRole('radio', { name: 'Evening' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(dayButton('Wednesday', 16)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
    expect(dayButton('Monday', 14)).toHaveAccessibleName(/, 5:30–10:30 pm$/);
  });

  it('sets two times in a day with From and to, and sends the windows painting those cells would (ADR 0013)', async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: null });
    open();
    await screen.findByText('Which days could work?');

    fireEvent.click(dayButton('Tuesday', 15));
    eachDay();
    byTheHalfHour('Tuesday');
    // 12 to 4 pm, then a second time, 6:30 to 9 pm.
    pick('from', 'Tuesday', '5:30 pm', '12:00 pm');
    pick('to', 'Tuesday', '10:30 pm', '4:00 pm');
    fireEvent.click(screen.getByRole('button', { name: 'Add another time' }));
    // To first: a From can only go as far as its own To.
    pick('to', 'Tuesday', '5:30 pm', '9:00 pm');
    pick('from', 'Tuesday', '4:30 pm', '6:30 pm');
    backToAnswer();
    await send();

    // Melbourne is UTC+10: noon to 4 pm and 6:30 to 9 pm on Tuesday 15.
    const { idempotencyKey, ...payload } = submitAnswer.mock.calls[0]![0];
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(payload).toEqual({
      planId: PLAN.id,
      revision: 1,
      status: 'windows',
      windows: [
        { start: '2099-09-15T02:00:00.000Z', end: '2099-09-15T06:00:00.000Z' },
        { start: '2099-09-15T08:30:00.000Z', end: '2099-09-15T11:00:00.000Z' },
      ],
    });
  });

  it('sends Thursday evening and Tuesday daytime as the windows painting them by hand would (ADR 0013)', async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: null });
    open();
    await screen.findByText('Which days could work?');

    fireEvent.click(dayButton('Thursday', 17));
    fireEvent.click(dayButton('Tuesday', 15));
    eachDay();
    fireEvent.click(within(dayRow('Tuesday')).getByRole('radio', { name: 'Daytime' }));
    expect(within(dayRow('Thursday')).getByRole('radio', { name: 'Evening' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await send();

    // Melbourne is UTC+10: Tuesday 9 am–5 pm, Thursday 5:30–10:30 pm.
    const { idempotencyKey, ...payload } = submitAnswer.mock.calls[0]![0];
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(payload).toEqual({
      planId: PLAN.id,
      revision: 1,
      status: 'windows',
      windows: [
        { start: '2099-09-14T23:00:00.000Z', end: '2099-09-15T07:00:00.000Z' },
        { start: '2099-09-17T07:30:00.000Z', end: '2099-09-17T12:30:00.000Z' },
      ],
    });
  });

  it.each([
    [
      9 * 60,
      12 * 60,
      'mornings',
      '9 am–12 pm',
      '2099-09-13T23:00:00.000Z',
      '2099-09-14T02:00:00.000Z',
    ],
    [
      12 * 60,
      17 * 60,
      'afternoons',
      '12–5 pm',
      '2099-09-14T02:00:00.000Z',
      '2099-09-14T07:00:00.000Z',
    ],
  ])(
    'asks which %s on a plan from %i to %i minutes, with nothing to pick, and sends its band as the window (ADR 0013)',
    async (startMin, endMin, band, line, start, end) => {
      planToAnswer.mockResolvedValue({
        plan: { ...PLAN, dailyStartMin: startMin, dailyEndMin: endMin },
        answer: null,
      });
      open();
      await screen.findByText(`Which ${band} could work?`);
      expect(
        screen.getByRole('button', { name: new RegExp(`None of these ${band} work for me`) }),
      ).toBeInTheDocument();

      answerMonday();
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Adjust hours' })).toBeInTheDocument();
      await send();

      const { idempotencyKey, ...payload } = submitAnswer.mock.calls[0]![0];
      expect(idempotencyKey).toEqual(expect.any(String));
      expect(payload).toEqual({
        planId: PLAN.id,
        revision: 1,
        status: 'windows',
        windows: [{ start, end }],
      });
    },
  );

  it('takes the days back to one time with "Same for every day"', async () => {
    planToAnswer.mockResolvedValue({ plan: WHOLE, answer: answerable.answer });
    open();
    await screen.findByText('Which days could work?');
    await differing();

    fireEvent.click(screen.getByRole('button', { name: 'Same for every day' }));
    // Back on the pills, every tapped day with the evening.
    expect(await screen.findByText('From 5:30 pm')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'A time for each day' })).toBeNull();
    await send();
    expect(submitAnswer.mock.calls[0]![0].windows).toEqual(
      [14, 16, 17].map((date) => ({
        start: `2099-09-${date}T07:30:00.000Z`,
        end: `2099-09-${date}T12:30:00.000Z`,
      })),
    );
  });

  it("dims the days under I'm easy and gives them back when it is turned off", async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();
    await differing();

    fireEvent.click(screen.getByRole('switch', { name: "I'm easy" }));
    expect(dayButton('Tuesday', 15)).toHaveAttribute('aria-disabled', 'true');
    // The block is out of play too: its clocks and Same for every day do nothing.
    expect(screen.getByRole('button', { name: /^Exact hours, Monday/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Same for every day' }));
    expect(screen.queryByRole('heading', { name: 'When, on those days?' })).toBeNull();
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
    await screen.findByText('Which evenings could work?');

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
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await screen.findByText('Your times are saved on this phone.');
    const draft = await readDraft('nina', CODE);
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
    await writeDraft('nina', CODE, {
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
    await writeDraft('nina', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    planToAnswer.mockRejectedValue(new Error('plan lookup failed'));
    open();

    await screen.findByText('7–9:30 pm');
  });
});

describe('what the device had, against what the server has', () => {
  it('prefers a draft newer than the stored answer: it is what the person last did', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    await writeDraft('nina', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
    open();

    await screen.findByText('7–9:30 pm');
    // Only the draft's Wednesday: the stored answer's other days are not tapped.
    expect(dayButton('Monday', 14)).toHaveAttribute('aria-pressed', 'false');
  });

  it('throws away a draft of a question that has since changed, and says so', async () => {
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });
    await writeDraft('nina', CODE, { plan: PLAN, windows: [MONDAY], flexible: false });
    open();

    await screen.findByText(/The plan changed/);
    expect(dayButton('Monday', 14)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: 'Your hours each evening' })).toBeNull();
    await waitFor(async () => expect(await readDraft('nina', CODE)).toBeUndefined());
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

    await screen.findByText('Replies have closed.');
  });

  it('resends a send in flight even when the server answer is newer than the draft', async () => {
    // The send committed and its reply was lost: the stored answer is later
    // than the draft, and only resending (a replay) clears the draft.
    planToAnswer.mockResolvedValue({
      plan: PLAN,
      answer: { ...answerable.answer, submittedAt: '2999-01-01T00:00:00Z' },
    });
    await writeDraft('nina', CODE, {
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
    await screen.findByText('Which evenings could work?');

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
    await writeDraft('nina', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
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
    await writeDraft('nina', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
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
    await writeDraft('nina', CODE, {
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

    // Nina signs out on a shared browser; Tom signs in, and the page stays.
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

    await screen.findByText('Which evenings could work?');
  });
});

describe('when the server says no', () => {
  it('asks the new question when the plan changed under the answer', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('stale_revision'));
    open();
    await screen.findByText('Which evenings could work?');
    planToAnswer.mockResolvedValue({ plan: { ...PLAN, revision: 2 }, answer: null });

    answerMonday();
    await send();

    await screen.findByText(/The plan changed/);
    expect(dayButton('Monday', 14)).toHaveAttribute('aria-pressed', 'false');
  });

  it('fetches the plan again, keeping the times, when days were taken away while it was open (ADR 0047)', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('outside_plan_window'));
    open();
    await screen.findByText('Which evenings could work?');
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

  it('keeps unsent times when days are taken away and the plan is read again (ADR 0047, round 2)', async () => {
    const client = open();
    await screen.findByText('Which evenings could work?');
    answerMonday();
    // Written to the device as it is painted, and not sent.
    await waitFor(async () => expect((await readDraft('nina', CODE))?.windows).toHaveLength(1));
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
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await screen.findByText('Replies have closed.');
  });

  it('asks the plan to include somebody who joined after it was made, then sends again', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('not_a_participant'));
    askToPlan.mockResolvedValue('asked');
    open();
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(askToPlan).toHaveBeenCalledWith(CODE);
    expect(submitAnswer.mock.calls[1]![0].idempotencyKey).toBe(
      submitAnswer.mock.calls[0]![0].idempotencyKey,
    );
  });

  it('says so, and keeps the times, when submit-availability refuses for volume (SUS-219)', async () => {
    submitAnswer.mockRejectedValueOnce(refusal('too_many_requests'));
    open();
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await screen.findByText(
      'Too many tries from here just now. Wait a few minutes, then try again.',
    );
    expect(screen.getByRole('button', { name: 'Send my times' })).toBeEnabled();
    expect((await readDraft('nina', CODE))?.windows).toEqual([MONDAY_EVENING]);
  });

  it('gives a reference to quote when something else went wrong, and keeps the times', async () => {
    submitAnswer.mockRejectedValueOnce(refusal(undefined));
    open();
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await screen.findByText("Something didn't save.");
    expect(screen.getByText('Ref R1')).toBeInTheDocument();
    expect(screen.getByText(/send Maya this reference/)).toBeInTheDocument();
    expect((await readDraft('nina', CODE))?.windows).toEqual([MONDAY_EVENING]);
  });
});

describe('a server that answered is not an offline phone (SUS-200)', () => {
  it('says something went wrong, not "saved on this phone", when the answer was a 5xx with no body', async () => {
    // `FunctionsHttpError` with a body that is not a Problem: a gateway page. It reached the server.
    submitAnswer.mockRejectedValueOnce(new FunctionError(undefined, 'submit-availability failed'));
    open();
    await screen.findByText('Which evenings could work?');

    answerMonday();
    await send();

    await screen.findByText("Something didn't save.");
    expect(screen.queryByText('Your times are saved on this phone.')).not.toBeInTheDocument();
    expect((await readDraft('nina', CODE))?.windows).toEqual([MONDAY_EVENING]);
  });
});

describe('none of these dates', () => {
  it.each([
    ["I'm keen, just not these dates", 'none_work'],
    ['Not enough notice', 'more_notice'],
    ['Not this time', 'not_this_time'],
  ])('"%s" sends %s, with no windows', async (label, status) => {
    open('none');

    const option = await screen.findByRole('button', {
      name: new RegExp(`^${label.replace(/'/g, '.')}\\.`),
    });
    await act(async () => {
      fireEvent.click(option);
    });

    expect(submitAnswer).toHaveBeenCalledWith(expect.objectContaining({ status, windows: [] }));
    expect(track).toHaveBeenCalledWith('availability_submitted', {
      plan_id: PLAN.id,
      status,
      window_count: 0,
      usual_used: false,
    });
  });

  it('names the organiser as the person who sees "keen"', async () => {
    open('none');

    await screen.findByText("Maya sees you'd like to come.");
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

    await screen.findByText('Which evenings could work?');
    expect(screen.queryByText('how it is looking')).toBeNull();
  });

  it('is the editor for somebody whose changed answer is still waiting on the device (round 1)', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    await writeDraft('nina', CODE, {
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
    await writeDraft('nina', CODE, { plan: PLAN, windows: [WEDNESDAY], flexible: false });
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
    expect(screen.queryByRole('heading', { name: 'Your hours each evening' })).toBeNull();
  });

  it('says nothing of the kind to somebody who never answered an earlier question', async () => {
    planToAnswer.mockResolvedValue({ plan: REVISED, answer: null, answeredEarlierRevision: false });
    open();

    await screen.findByText('Which evenings could work?');
    expect(screen.queryByText(/The plan changed/)).toBeNull();
  });

  it('stops saying it once they have answered the question as it is now', async () => {
    planToAnswer.mockResolvedValue({
      plan: REVISED,
      answer: answerable.answer,
      answeredEarlierRevision: true,
    });
    open();

    await screen.findByText('Which evenings could work?');
    expect(screen.queryByText(/The plan changed/)).toBeNull();
  });
});

describe('what the others have said (SUS-129)', () => {
  afterEach(() => othersSaid.mockReset());

  it('shows the counts it reads, in words, and sends exactly the answer it would without them', async () => {
    othersSaid.mockResolvedValue(othersPartial);
    open();
    // The counts first: while the read is out the screen holds the longer line
    // as invisible room (SUS-136), so the line alone does not say they are in.
    expect(
      await screen.findByRole('button', { name: /^Thursday\D*17.*, 4 others could make it$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tap or drag across the evenings. The number is how many can make it.'),
    ).toBeInTheDocument();
    expect(othersSaid).toHaveBeenCalledWith(PLAN.id);

    // The tile counts the reader once it is tapped, and says so in words.
    const before = dayButton('Monday', 14).textContent;
    answerMonday();
    expect(dayButton('Monday', 14)).toHaveAccessibleName(
      /(only you so far|you and \d+ others? can make it)$/,
    );
    expect(dayButton('Monday', 14).textContent).not.toBe(before);
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
    await screen.findByText(/^Tap or drag across the evenings\. The number/);
    answerMonday();
    await waitFor(async () => expect(await readDraft('nina', CODE)).toBeDefined());
    const draft = JSON.stringify(await readDraft('nina', CODE));
    expect(draft).not.toMatch(/answered|others|withTimes|flexible"?:\s*\d/);
  });

  it('says the reader is first, and shows no counts, below the threshold', async () => {
    othersSaid.mockResolvedValue(othersFirst);
    open();
    // Below the threshold there is no number, so the line does not explain one.
    expect(await screen.findByText('Tap or drag across the evenings.')).toBeInTheDocument();
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
    await screen.findByText('Which evenings could work?');
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_started', {
        plan_id: PLAN.id,
        usual_offered: false,
      }),
    );
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
    await screen.findByText(/^Tap or drag across the evenings\. The number/);
    first.unmount();

    othersSaid.mockReset();
    othersSaid.mockRejectedValue(new Error('offline'));
    track.mockReset();
    render(editor());
    await screen.findByText('Which evenings could work?');
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('availability_others_read', {
        plan_id: PLAN.id,
        others_shown: false,
      }),
    );
    expect(screen.getByText('Tap or drag across the evenings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /could make it$/ })).toBeNull();
  });

  it('leaves the editor as it was when the read fails, and the answer still goes', async () => {
    othersSaid.mockRejectedValue(new Error('offline'));
    open();
    await screen.findByText('Which evenings could work?');
    await waitFor(() => expect(othersSaid).toHaveBeenCalled());
    expect(screen.getByText('Tap or drag across the evenings.')).toBeInTheDocument();

    answerMonday();
    expect(screen.queryByText(/overlap/i)).toBeNull();
    await send();
    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'windows', windows: [MONDAY_EVENING] }),
    );
  });
});
