import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';
import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';

/**
 * The first run before sign-in (ADR 0053, ADR 0090): the circle, the plan and the
 * organiser's own evenings are drafted on the device, nothing reaches the server
 * until the code is accepted, and the finish makes them once each, in order.
 * What each screen records, what it sends, and, the invariant, that walking away
 * before the code creates nothing.
 */

const push = vi.fn();
const replace = vi.fn();
const focus = { epoch: 0 };
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    // Runs the effect on mount and again whenever a test says the screen came
    // back into view.
    useFocusEffect: (effect: () => void) => {
      const epoch = focus.epoch;
      useEffect(() => effect(), [effect, epoch]);
    },
  };
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'none', userId: undefined as string | undefined, isLoading: false };
const ownProfile = vi.fn();
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  const { safeReturnPath } = await import('../../data/auth/returnPath');
  return {
    guard,
    safeReturnPath,
    useSession: () => session,
    deviceTimeZone: () => 'Australia/Melbourne',
    ownProfile: () => ownProfile(),
  };
});
const createCircle = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  createCircle: (...a: unknown[]) => createCircle(...a),
}));
const createPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createPlan: (...a: unknown[]) => createPlan(...a),
}));
const submitAnswer = vi.fn();
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  submitAnswer: (...a: unknown[]) => submitAnswer(...a),
}));

const { FirstCircleFlow } = await import('./FirstCircleFlow');
const { FinishDraftFlow } = await import('./FinishDraftFlow');
const { FirstPlanDraftFlow } = await import('../planning/FirstPlanDraftFlow');
const { SavePlaceFlow } = await import('../identity/SavePlaceFlow');
const { DEFAULT_PLAN, keepArrivalTag, readArrivalTag, readDraft, saveDraft } =
  await import('../../data/draft');
const { FunctionError } = await import('../../data/functions');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
// Made at run time: a fixed secret-shaped literal is what a scanner looks for.
const SECRET = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

/**
 * Thursday 22 October 2026, 1 pm in Melbourne, which is where the device is. A
 * monthly window from today is Thu 22 Oct to Wed 18 Nov; the deadline a plan
 * made now defaults to is Sunday 25 October at 6 pm.
 */
const NOW = Date.parse('2026-10-22T02:00:00.000Z');
const THE_PLAN = {
  plan_id: PLAN,
  short_code: 'abcdefgh',
  window: { start: '2026-10-22', end: '2026-11-18' },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  duration_minutes: 120,
  quorum: 3,
  response_deadline: '2026-10-25T07:00:00.000Z',
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

/** A draft ready to be made: signed in, a name, the monthly plan, and two evenings. */
async function draftReady(answer: { days: string[]; later?: boolean } | undefined = undefined) {
  return await saveDraft({
    circleName: 'Sunday Crew',
    cadence: 'fortnightly',
    proceed: true,
    answer: answer ?? { days: ['2026-10-27', '2026-10-29'] },
  });
}

/** The days of the grid that are evenings, as a person would tap them. */
function evenings() {
  return screen.getAllByRole('button', { name: /, evening$/ });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  Object.assign(session, { status: 'none', userId: undefined, isLoading: false });
  for (const mock of [push, replace, track, createCircle, createPlan, submitAnswer, ownProfile]) {
    mock.mockReset();
  }
  ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Europe/London' });
  createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
  createPlan.mockResolvedValue(THE_PLAN);
  submitAnswer.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('screen 1: who it is for', () => {
  it('holds the name as a draft that is monthly, goes on, and creates nothing', async () => {
    wrap(<FirstCircleFlow />);

    fireEvent.change(await screen.findByLabelText('Who do you keep meaning to see?'), {
      target: { value: ' Sunday  Crew ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/circles/new/plan'));
    expect(createCircle).not.toHaveBeenCalled();
    // Cadence left the first screen: a new circle is monthly (ADR 0090).
    expect(await readDraft()).toMatchObject({ circleName: 'Sunday Crew', cadence: 'monthly' });
    expect(track).toHaveBeenCalledWith('organiser_draft_started', {});
  });

  it('shows the first line of the message filling in as the name is typed', async () => {
    wrap(<FirstCircleFlow />);
    const field = await screen.findByLabelText('Who do you keep meaning to see?');

    // Nothing typed: the placeholder words, so the message reads from the start.
    expect(screen.getByText('To your group chat')).toBeVisible();
    expect(screen.getByText('No app, no account.')).toBeVisible();
    fireEvent.change(field, { target: { value: 'Thursday Lot' } });
    expect(screen.getByText('To Thursday Lot')).toBeVisible();
    expect(screen.getByText('Thursday Lot')).toBeVisible();
    expect(screen.getByText(/actually catch up\?/)).toBeVisible();
    // One field, one question, said once: no cadence, no kicker label, "1 of 3".
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Step 1 of 2/)).toBeNull();
    expect(screen.getByText('1 of 3')).toBeVisible();
    expect(field.getAttribute('placeholder')).toBe('e.g. the name of your group chat');
  });

  it('offers a quiet Sign in to a returning organiser, and no account is asked for', async () => {
    wrap(<FirstCircleFlow />);
    await tap(screen.findByRole('button', { name: 'Sign in' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
  });

  it('brings the draft back after a reload', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstCircleFlow />);

    await waitFor(() =>
      expect(screen.getByLabelText('Who do you keep meaning to see?')).toHaveValue('Sunday Crew'),
    );
  });

  it('does not renew a draft just by showing it', async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = NOW - day + 3_600_000;
    await saveDraft({ circleName: 'Sunday Crew' }, old);
    wrap(<FirstCircleFlow />);
    await waitFor(() =>
      expect(screen.getByLabelText('Who do you keep meaning to see?')).toHaveValue('Sunday Crew'),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect((await readDraft())?.updatedAt).toBe(old);
  });

  it('refuses an unusable name without writing a draft', async () => {
    wrap(<FirstCircleFlow />);
    await act(async () => {
      await tap(screen.findByRole('button', { name: 'Next' }));
    });
    expect(screen.getByText('Give the group a name of up to 40 characters.')).toBeVisible();
    expect(push).not.toHaveBeenCalled();
    expect(await readDraft()).toBeNull();
  });

  it('shows a signed-in organiser a way back, no Sign in, and two screens to go', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    wrap(<FirstCircleFlow />);
    await screen.findByLabelText('Who do you keep meaning to see?');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(screen.getByText('1 of 2')).toBeVisible();
  });
});

describe('screen 2: which evenings could you do', () => {
  it('is the monthly window by default, with the grid, the plan in one line and nothing to count', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);

    expect(await screen.findByText('Which evenings could you do?')).toBeVisible();
    expect(screen.getByText('Friends get the same question.')).toBeVisible();
    expect(screen.getByText('2 of 3')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Monthly' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Next 2 weeks' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'This weekend' })).not.toBeChecked();
    // Tonight is the full setup's, and the quorum line and the exits are gone.
    expect(screen.queryByRole('checkbox', { name: 'Tonight' })).toBeNull();
    expect(screen.queryByText(/need to make it/)).toBeNull();
    expect(screen.queryByText('Just invite people for now')).toBeNull();
    expect(screen.queryByText('See if people are keen instead')).toBeNull();
    expect(screen.queryByText(/Step 2 of 2/)).toBeNull();
    // Four weeks from today, one button each, no Today tag.
    expect(evenings()).toHaveLength(28);
    expect(screen.queryByText('Today')).toBeNull();
    // 6 pm, about three days out: Thursday's plan closes on Sunday.
    expect(screen.getByText('Evenings · about 2 hours · replies close Sun 6 pm')).toBeVisible();
  });

  it('waits for an evening: Next says what is missing when pressed early, and creates nothing', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');

    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    // Pressed anyway, as a finger does: the cover over it takes the press.
    await act(async () => {
      fireEvent.click(screen.getByTestId('waiting-press'));
    });
    expect(screen.getByText('Pick at least one evening first.')).toBeVisible();
    expect(push).not.toHaveBeenCalled();
    expect(createCircle).not.toHaveBeenCalled();
  });

  it('writes the evenings picked into the draft, and a reload brings them back', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    const view = wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');

    fireEvent.click(evenings()[5]!);
    fireEvent.click(evenings()[7]!);
    expect(evenings()[5]).toHaveAttribute('aria-pressed', 'true');
    // "I'll add mine later" is only for while nothing is picked.
    expect(screen.queryByRole('button', { name: "I'll add mine later" })).toBeNull();
    await waitFor(async () =>
      expect((await readDraft())?.answer?.days).toEqual(['2026-10-27', '2026-10-29']),
    );

    view.unmount();
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');
    await waitFor(() => expect(evenings()[5]).toHaveAttribute('aria-pressed', 'true'));
    expect(evenings()[7]).toHaveAttribute('aria-pressed', 'true');
    expect(evenings()[6]).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the days that fit a new window, and drops the ones that do not', async () => {
    await saveDraft({
      circleName: 'Sunday Crew',
      answer: { days: ['2026-10-23', '2026-10-30'] },
    });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');
    const before = await readDraft();

    // The next two weeks is Thu 22 Oct to Wed 4 Nov: the 30th is in, and so is the 23rd.
    await tap(screen.getByRole('checkbox', { name: 'Next 2 weeks' }));
    await waitFor(async () => expect((await readDraft())?.plan.preset).toBe('next_14_days'));
    expect(evenings()).toHaveLength(14);
    expect((await readDraft())?.answer?.days).toEqual(['2026-10-23', '2026-10-30']);

    // This weekend is Sat 24 and Sun 25: neither was picked, so nothing is kept.
    await tap(screen.getByRole('checkbox', { name: 'This weekend' }));
    await waitFor(async () => expect((await readDraft())?.plan.preset).toBe('this_weekend'));
    expect(await screen.findByText('Which days could you do this weekend?')).toBeVisible();
    expect((await readDraft())?.answer?.days).toEqual([]);
    // A different plan is a different question: new keys for it and its answer.
    const after = await readDraft();
    expect(after?.keys.plan).not.toBe(before?.keys.plan);
    expect(after?.keys.answer).not.toBe(before?.keys.answer);
  });

  it('goes on with "I\'ll add mine later" to the gate, with no answer to send', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "I'll add mine later" }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/circles/new/save'));
    expect(await readDraft()).toMatchObject({ answer: { days: [], later: true }, proceed: false });
    expect(createCircle).not.toHaveBeenCalled();
  });

  it('goes to the gate for somebody with no saved place, with their evenings, creating nothing', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');
    fireEvent.click(evenings()[5]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/circles/new/save'));
    expect(createCircle).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(await readDraft()).toMatchObject({
      answer: { days: ['2026-10-27'] },
      proceed: false,
    });
  });

  it('skips the gate for a signed-in organiser: Make the link, two of two', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await saveDraft({ circleName: 'Sunday Crew', answer: { days: ['2026-10-27'] } });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');
    expect(screen.getByText('2 of 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make the link' }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/circles/new/finish'));
    expect(await readDraft()).toMatchObject({ proceed: true });
  });

  it('sets the time of day, the length and when replies close from Adjust, into the draft', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');

    await tap(screen.getByRole('button', { name: 'Adjust' }));
    const sheet = await screen.findByRole('dialog', { name: 'Adjust the plan' });
    const inSheet = within(sheet);
    // Days and evenings, three hours, and Monday: the day after the default.
    await tap(inSheet.getByRole('checkbox', { name: /^Days and evenings, / }));
    await tap(inSheet.getByRole('checkbox', { name: 'About 3 hours' }));
    await waitFor(async () => expect((await readDraft())?.plan.duration).toBe(180));
    await tap(inSheet.getByRole('checkbox', { name: 'Mon 6 pm' }));
    await tap(inSheet.getByRole('button', { name: 'Done' }));

    await waitFor(async () =>
      expect((await readDraft())?.plan).toMatchObject({
        duration: 180,
        band: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
        deadline: '2026-10-26T07:00:00.000Z',
      }),
    );
    expect(await screen.findByText('Which days could you do?')).toBeVisible();
    expect(
      screen.getByText('Days and evenings · about 3 hours · replies close Mon 6 pm'),
    ).toBeVisible();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('keeps the evenings picked when More options opens the full setup', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');
    fireEvent.click(evenings()[5]!);

    await tap(screen.getByRole('button', { name: 'Adjust' }));
    await tap(await screen.findByRole('button', { name: 'More options' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/circles/new/plan/setup'));
    expect((await readDraft())?.answer?.days).toEqual(['2026-10-27']);
  });

  it('sends a card left behind after the finish back to the start when it is seen again', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await saveDraft({ circleName: 'Sunday Crew' });
    const view = wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Which evenings could you do?');

    localStorage.clear();
    focus.epoch += 1;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FirstPlanDraftFlow />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
    expect(createCircle).not.toHaveBeenCalled();
  });

  it('does not offer the screen when the signed-in profile cannot be read', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    ownProfile.mockRejectedValue(new Error('down'));
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);

    await screen.findByText("We couldn't load this circle.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Make the link' })).toBeNull();
  });

  it('goes back to the first screen when there is no draft (expired or never made)', async () => {
    wrap(<FirstPlanDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });
});

describe('the finish', () => {
  const SHARE = (answer: 'answered' | 'later') => ({
    pathname: '/circles/[id]/plan/[planId]/shared',
    params: { id: CIRCLE, planId: PLAN, first: answer },
  });

  it('makes the circle, the plan, then the organiser answer, once each and in that order, and clears the draft', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    const { draft } = await draftReady();
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('answered')));
    expect(createCircle).toHaveBeenCalledTimes(1);
    expect(createCircle).toHaveBeenCalledWith({
      name: 'Sunday Crew',
      cadence: 'fortnightly',
      timeZone: 'Europe/London',
      idempotencyKey: draft.keys.circle,
    });
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        circleId: CIRCLE,
        preset: 'next_28_days',
        idempotencyKey: draft.keys.plan,
      }),
    );
    // The answer, to the revision the plan was made at, with a key of its own,
    // for each evening picked, across the plan's own band, in the circle's zone.
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(submitAnswer).toHaveBeenCalledWith({
      planId: PLAN,
      revision: 1,
      status: 'windows',
      windows: [
        { start: '2026-10-27T17:30:00.000Z', end: '2026-10-27T22:30:00.000Z' },
        { start: '2026-10-29T17:30:00.000Z', end: '2026-10-29T22:30:00.000Z' },
      ],
      idempotencyKey: draft.keys.answer,
    });
    expect(draft.keys.answer).not.toBe(draft.keys.plan);
    const order = [createCircle, createPlan, submitAnswer].map(
      (mock) => mock.mock.invocationCallOrder[0]!,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(track).toHaveBeenCalledWith('circle_created', { circle_id: CIRCLE });
    expect(track).toHaveBeenCalledWith(
      'plan_created',
      expect.objectContaining({ window: 'next_28_days', used_defaults: true }),
    );
    expect(track).toHaveBeenCalledWith('availability_submitted', {
      plan_id: PLAN,
      status: 'windows',
      window_count: 2,
      usual_used: false,
    });
    expect(await readDraft()).toBeNull();
    // The invite secret is held in memory and never put in the address.
    expect(JSON.stringify(replace.mock.calls)).not.toContain(SECRET);
  });

  it('skips the answer, and still shares, when the organiser chose to add theirs later', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady({ days: [], later: true });
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('later')));
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(submitAnswer).not.toHaveBeenCalled();
    expect(track.mock.calls.filter(([name]) => name === 'availability_submitted')).toEqual([]);
  });

  it('skips the answer for a draft that never had one: a version 2 record still in a browser', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    globalThis.localStorage.setItem(
      'circles.organiser-draft',
      JSON.stringify({
        v: 2,
        updatedAt: NOW,
        circleName: 'Sunday Crew',
        cadence: 'monthly',
        plan: { category: 'catch_up', preset: 'next_14_days', duration: 120 },
        way: 'ask',
        proceed: true,
        circleCounted: false,
        keys: { circle: globalThis.crypto.randomUUID(), plan: globalThis.crypto.randomUUID() },
      }),
    );
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('later')));
    expect(createCircle).toHaveBeenCalledTimes(1);
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ preset: 'next_14_days' }));
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it('drops the days that went by while they signed in, and skips the answer when none is left', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    // Two days before the plan's window began, and one the plan still asks about.
    await draftReady({ days: ['2026-10-20', '2026-10-21', '2026-10-28'] });
    const view = wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('answered')));
    expect(submitAnswer.mock.calls[0]?.[0]).toMatchObject({
      windows: [{ start: '2026-10-28T17:30:00.000Z', end: '2026-10-28T22:30:00.000Z' }],
    });

    view.unmount();
    replace.mockReset();
    submitAnswer.mockReset();
    submitAnswer.mockResolvedValue({});
    await draftReady({ days: ['2026-10-20', '2026-10-21'] });
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('later')));
    // Skipped, not refused: the plan was still made and shared.
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it('answers only for what is left of today, from the next half hour', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    // 7:10 pm in London (still summer time) on the day: the evening begins at
    // 7:30 pm, not 5:30 pm, and ends at 10:30 pm.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-22T18:10:00.000Z'));
    await draftReady({ days: ['2026-10-22'] });
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(submitAnswer.mock.calls[0]?.[0]).toMatchObject({
      windows: [{ start: '2026-10-22T18:30:00.000Z', end: '2026-10-22T21:30:00.000Z' }],
    });
  });

  it('shares the plan with the answer skipped when the server refuses the answer itself', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    submitAnswer.mockRejectedValue(
      new FunctionError(
        { error: 'conflict', reason: 'outside_plan_window', message: 'x' } as never,
        'x',
      ),
    );
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('later')));
    expect(track.mock.calls.filter(([name]) => name === 'availability_submitted')).toEqual([]);
    expect(await readDraft()).toBeNull();
  });

  it('sends the campaign tag the organiser arrived on with the circle, and forgets it once it is made (SUS-240)', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    await keepArrivalTag('tt-always-the-one-3');
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(createCircle).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'tt-always-the-one-3' }),
    );
    expect(await readArrivalTag()).toBeUndefined();
    // The share is told the arrival was tagged, and nothing more of it.
    expect(replace).toHaveBeenCalledWith({
      ...SHARE('answered'),
      params: { ...SHARE('answered').params, tagged: '1' },
    });
    // A label for the circle's founder-only row: never in an event or an address.
    expect(JSON.stringify(track.mock.calls)).not.toContain('tt-always-the-one-3');
    expect(JSON.stringify(replace.mock.calls)).not.toContain('tt-always-the-one-3');
  });

  it('sends no tag when no tagged link brought the organiser', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(createCircle.mock.calls[0]?.[0]).not.toHaveProperty('sourceRef', expect.anything());
  });

  it('keeps the draft when the plan fails, and Try again sends the same three keys', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    createPlan.mockRejectedValueOnce(new Error('timeout'));
    wrap(<FinishDraftFlow />);

    // Back to the plan is offered beside it, and what was chosen is kept.
    expect(await screen.findByRole('button', { name: 'Back to the plan' })).toBeVisible();
    await tap(screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalled());

    const keys = (mock: typeof createCircle) =>
      mock.mock.calls.map(([o]) => (o as { idempotencyKey: string }).idempotencyKey);
    expect(keys(createCircle)).toHaveLength(2);
    expect(keys(createCircle)[0]).toBe(keys(createCircle)[1]);
    expect(keys(createPlan)).toHaveLength(2);
    expect(keys(createPlan)[0]).toBe(keys(createPlan)[1]);
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    expect(await readDraft()).toBeNull();
  });

  it('shares the plan with the answer skipped when the connection drops on it, rather than offering to go back over a plan that exists', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    submitAnswer.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status: 0 }),
    );
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('later')));
    expect(screen.queryByRole('button', { name: 'Back to the plan' })).toBeNull();
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(await readDraft()).toBeNull();
  });

  it('keeps the draft when the answer is rate limited, and the second run sends the same keys', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    const { draft } = await draftReady();
    submitAnswer.mockRejectedValueOnce(
      new FunctionError(
        { error: 'rate_limited', reason: 'too_many_requests', message: 'x' } as never,
        'x',
      ),
    );
    wrap(<FinishDraftFlow />);

    await tap(screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('answered')));
    const keyOf = (mock: typeof createPlan) =>
      mock.mock.calls.map(([o]) => (o as { idempotencyKey: string }).idempotencyKey);
    expect(keyOf(submitAnswer)).toEqual([draft.keys.answer, draft.keys.answer]);
    // One plan, one key, and counted once however often it was asked for.
    expect(keyOf(createPlan)).toEqual([draft.keys.plan, draft.keys.plan]);
    expect(track.mock.calls.filter(([name]) => name === 'plan_created')).toHaveLength(1);
  });

  it('counts the answer as in when the server already holds the key for an earlier run', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    submitAnswer.mockRejectedValueOnce(
      new FunctionError(
        { error: 'conflict', reason: 'idempotency_mismatch', message: 'x' } as never,
        'x',
      ),
    );
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('answered')));
  });

  it("writes an evening that ends at midnight as the next day's first instant", async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady({ days: ['2026-10-28'] });
    createPlan.mockResolvedValue({ ...THE_PLAN, daily: { startMin: 18 * 60, endMin: 24 * 60 } });
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARE('answered')));
    expect(submitAnswer.mock.calls[0]?.[0]).toMatchObject({
      windows: [{ start: '2026-10-28T18:00:00.000Z', end: '2026-10-29T00:00:00.000Z' }],
    });
  });

  it('counts the circle once, however many times the finish runs', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    createPlan.mockRejectedValueOnce(new Error('timeout'));
    wrap(<FinishDraftFlow />);

    await tap(screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalled());

    expect(createCircle).toHaveBeenCalledTimes(2);
    expect(track.mock.calls.filter(([name]) => name === 'circle_created')).toHaveLength(1);
  });

  it('offers a way back to the plan when the time went by, not a retry that cannot work', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    createPlan.mockRejectedValueOnce(
      new FunctionError(
        { error: 'conflict', reason: 'window_has_passed', message: 'x' } as never,
        'x',
      ),
    );
    wrap(<FinishDraftFlow />);

    await screen.findByRole('button', { name: 'Change the time' });
    fireEvent.click(screen.getByRole('button', { name: 'Change the time' }));
    expect(replace).toHaveBeenCalledWith('/circles/new/plan');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // Kept: the circle made so far is the same one when the plan is asked again.
    expect(await readDraft()).not.toBeNull();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it('asks for a name first when the account has none and the gate did not supply one', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    ownProfile.mockResolvedValue({ name: null, zone: null });
    await draftReady();
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(createCircle).not.toHaveBeenCalled();
    expect(await readDraft()).not.toBeNull();
  });

  it('sends somebody with no saved place back to the gate, creating nothing', async () => {
    await draftReady();
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/save'));
    expect(createCircle).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
    expect(submitAnswer).not.toHaveBeenCalled();
  });

  it('does nothing without a draft', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
    expect(createCircle).not.toHaveBeenCalled();
  });
});

describe("screen 3: who's asking, as the route draws it", () => {
  it('asks a first name and an email for a draft with a name, and counts the gate shown once', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    const view = wrap(<SavePlaceFlow />);

    expect(await screen.findByText("Who's asking?")).toBeVisible();
    expect(screen.getByText('Sunday Crew')).toBeVisible();
    expect(screen.queryByText(/Save your place/)).toBeNull();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SavePlaceFlow />
      </QueryClientProvider>,
    );
    const shown = track.mock.calls.filter(([name]) => name === 'organiser_gate_shown');
    expect(shown).toEqual([['organiser_gate_shown', {}]]);
    expect(createCircle).not.toHaveBeenCalled();
  });

  it('goes back to the first screen when there is nothing to save', async () => {
    wrap(<SavePlaceFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
    expect(track).not.toHaveBeenCalledWith('organiser_gate_shown', expect.anything());
  });

  it('sends on somebody who is already signed in, without asking for anything', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<SavePlaceFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
    expect(track).not.toHaveBeenCalledWith('organiser_gate_shown', expect.anything());
    expect(await readDraft()).toMatchObject({ proceed: true });
  });
});

describe('the draft plan', () => {
  it('is the next four weeks until somebody says otherwise', () => {
    expect(DEFAULT_PLAN.preset).toBe('next_28_days');
  });
});
