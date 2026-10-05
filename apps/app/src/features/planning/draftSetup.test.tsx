import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';

/**
 * The plan setup in its draft mode (ADR 0053): before there is a circle, every
 * "Change" on the First plan card opens the full setup, which reads the device's
 * draft and writes it back. It calls nothing on the server; the finish makes the
 * plan from what the draft holds.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    useFocusEffect: (effect: () => void) => {
      useEffect(() => effect(), [effect]);
    },
  };
});
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya' as string | undefined, isLoading: false };
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    deviceTimeZone: () => 'Australia/Melbourne',
    ownProfile: async () => ({ name: 'Maya', zone: 'Australia/Melbourne' }),
  };
});
const circleHome = vi.fn();
const createCircle = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
  createCircle: (...a: unknown[]) => createCircle(...a),
}));
const createPlan = vi.fn();
const createFirstPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createPlan: (...a: unknown[]) => createPlan(...a),
  createFirstPlan: (...a: unknown[]) => createFirstPlan(...a),
}));
const network = vi.fn();

const { FirstPlanDraftFlow } = await import('./FirstPlanDraftFlow');
const { PlanSetupDraftFlow } = await import('./PlanSetupDraftFlow');
const { FinishDraftFlow } = await import('../circles/FinishDraftFlow');
const { DEFAULT_PLAN, readDraft, saveDraft } = await import('../../data/draft');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
const SECRET = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

/** Edits the setup as an organiser would: later hours, longer, replies closing sooner. */
async function editTheSetup() {
  const view = wrap(<PlanSetupDraftFlow />);
  await screen.findByRole('button', { name: 'Save plan' });
  fireEvent.click(screen.getByRole('checkbox', { name: /^Daytime/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '3 hrs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /^In a day/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  });
  return view;
}

beforeEach(() => {
  globalThis.localStorage.clear();
  Object.assign(session, { status: 'saved', userId: 'maya', isLoading: false });
  for (const mock of [push, replace, circleHome, createCircle, createPlan, createFirstPlan]) {
    mock.mockReset();
  }
  network.mockReset();
  vi.stubGlobal('fetch', network);
  createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
  createPlan.mockResolvedValue({ plan_id: PLAN });
});

describe('the First plan card, before sign-in', () => {
  it('has a Change on the window, the length and the replies, and opens the setup', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);

    await screen.findByText('Most of the group need to make it');
    // The quorum is "Most of the group" until there is a group: no number to set.
    const changes = screen.getAllByRole('button', { name: 'Change' });
    expect(changes).toHaveLength(3);
    fireEvent.click(changes[0]!);
    expect(push).toHaveBeenCalledWith('/circles/new/plan/setup');
    expect(screen.getByText(/Tap anything to change it/)).toBeVisible();
  });
});

describe('the card, with a slow device write', () => {
  it('holds Ask the group until a window just picked is written, so the old plan is not written over it', async () => {
    const { sessionStorage } = await import('../../data/auth/storage');
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Most of the group need to make it');

    const write = sessionStorage.setItem.bind(sessionStorage);
    const slow = vi.spyOn(sessionStorage, 'setItem').mockImplementation(async (key, value) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await write(key, value);
    });
    try {
      fireEvent.click(screen.getByRole('checkbox', { name: 'This weekend' }));
      // Held: the button is off while the write is out.
      expect(screen.getByRole('button', { name: /^Ask/ })).toBeDisabled();
      await waitFor(async () =>
        expect(await readDraft()).toMatchObject({ plan: { preset: 'this_weekend' } }),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await readDraft())?.plan.preset).toBe('this_weekend');
    } finally {
      slow.mockRestore();
    }
  });
});

describe('the plan setup in draft mode', () => {
  it('is the full setup, less what a circle of one cannot answer', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<PlanSetupDraftFlow />);

    await screen.findByRole('button', { name: 'Save plan' });
    for (const name of ['Catch up', 'Dinner', 'Drinks', 'Coffee', 'Activity']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('checkbox', { name: /^Evenings/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: '2 hrs' })).toBeVisible();
    expect(screen.getByText(/^Replies close in/)).toBeVisible();
    // Nobody to count and nobody to require: left out, not disabled.
    expect(screen.queryByText(/need to make it/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByText(/Who has to be there/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();
    expect(screen.getByText(/Nothing is sent until you've signed in/)).toBeVisible();
  });

  it('saves the evening band, the length and the deadline into the draft, calling nothing', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    await editTheSetup();

    expect(replace).toHaveBeenCalledWith('/circles/new/plan');
    const plan = (await readDraft())!.plan;
    expect(plan).toMatchObject({ preset: 'next_14_days', duration: 180 });
    expect(plan.band).toBeDefined();
    expect(plan.band!.startMin).toBeLessThan(17 * 60);
    expect(plan.deadline).toBeDefined();

    // The data layer was not touched, and neither was the network.
    for (const mock of [circleHome, createCircle, createPlan, createFirstPlan, network]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('comes back to the card showing the new values, and a reload keeps them', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    const view = await editTheSetup();
    view.unmount();

    // A reload: a fresh card, nothing held in memory but what the device kept.
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('About 3 hours');
    expect(screen.getByText(/^Days and evenings, /)).toBeVisible();
    expect(screen.getByText('Replies close in 24 hours')).toBeVisible();
    expect(screen.queryByText('Evenings and weekend days')).toBeNull();
    expect(circleHome).not.toHaveBeenCalled();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('starts from the draft, not from the defaults', async () => {
    await saveDraft({ circleName: 'Sunday Crew', plan: { ...DEFAULT_PLAN, duration: 90 } });
    wrap(<PlanSetupDraftFlow />);
    await screen.findByRole('button', { name: 'Save plan' });
    expect(screen.getByRole('checkbox', { name: '1.5 hrs' })).toBeChecked();
  });

  it('does not renew the draft by being opened, or by saving what is already there', async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = Date.now() - day + 3_600_000;
    await saveDraft({ circleName: 'Sunday Crew' }, old);
    wrap(<PlanSetupDraftFlow />);
    await screen.findByRole('button', { name: 'Save plan' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/plan'));
    expect((await readDraft())?.updatedAt).toBe(old);
  });

  it('still judges the form: hours too short for the meetup cannot be saved', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<PlanSetupDraftFlow />);
    await screen.findByRole('button', { name: 'Save plan' });

    fireEvent.click(screen.getByRole('checkbox', { name: '5 hrs' }));
    // "Custom" hours: the last "Custom" chip on the screen, after the one for the dates.
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Custom/ }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'End earlier' }));

    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    expect(await readDraft()).toMatchObject({ plan: { duration: 120 } });
  });

  it('goes back to the first circle when there is no draft', async () => {
    wrap(<PlanSetupDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });
});

describe('the finish, from the edited setup', () => {
  it("sends create-plan with the full setup and the draft's own key", async () => {
    await saveDraft({
      circleName: 'Sunday Crew',
      cadence: 'fortnightly',
      way: 'ask',
      proceed: true,
      plan: {
        category: 'dinner',
        preset: 'next_7_days',
        band: { startMin: 9 * 60, endMin: 13 * 60 },
        duration: 180,
        deadline: '2099-01-01T08:00:00.000Z',
      },
    });
    const { draft } = await saveDraft({});
    wrap(<FinishDraftFlow />);

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(createPlan).toHaveBeenCalledWith({
      circleId: CIRCLE,
      title: 'Dinner',
      category: 'dinner',
      preset: 'next_7_days',
      custom: undefined,
      daily: { startMin: 9 * 60, endMin: 13 * 60 },
      durationMinutes: 180,
      responseDeadline: '2099-01-01T08:00:00.000Z',
      idempotencyKey: draft.keys.plan,
    });
    // The quorum is not sent: it stays the server's, defaulted (ADR 0026).
    expect(createPlan.mock.calls[0]![0]).not.toHaveProperty('quorum');
    expect(createFirstPlan).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it('sends nothing the person did not choose when the setup is the defaults', async () => {
    await saveDraft({ circleName: 'Sunday Crew', way: 'ask', proceed: true });
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Catch up',
        category: 'catch_up',
        preset: 'next_14_days',
        daily: undefined,
        durationMinutes: undefined,
        responseDeadline: undefined,
      }),
    );
  });

  it('offers a way back to the card when the time chosen has gone by', async () => {
    const { FunctionError } = await import('../../data/functions');
    await saveDraft({ circleName: 'Sunday Crew', way: 'ask', proceed: true });
    createPlan.mockRejectedValueOnce(
      new FunctionError(
        { error: 'conflict', reason: 'deadline_out_of_range', message: 'x' } as never,
        'x',
      ),
    );
    wrap(<FinishDraftFlow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the time' }));
    expect(replace).toHaveBeenCalledWith('/circles/new/plan');
    expect(await readDraft()).not.toBeNull();
  });
});

describe('the card falls back when the draft no longer holds', () => {
  it('drops a deadline that has passed, and keeps the rest', async () => {
    await saveDraft({
      circleName: 'Sunday Crew',
      plan: { ...DEFAULT_PLAN, duration: 180, deadline: '2020-01-01T00:00:00.000Z' },
    });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('About 3 hours');
    expect(screen.getByText('Replies close in 3 days')).toBeVisible();
    expect(within(document.body).queryByText(/Jan 2020/)).toBeNull();
  });
});
