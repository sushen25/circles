import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';

/**
 * The first run before sign-in (ADR 0053): the circle and plan are drafted on
 * the device, nothing reaches the server until the place is saved, and the
 * finish makes them once. What each screen records, what it sends, and — the
 * invariant — that walking away at the gate creates nothing.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
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
const createFirstPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createFirstPlan: (...a: unknown[]) => createFirstPlan(...a),
}));

const { FirstCircleFlow } = await import('./FirstCircleFlow');
const { FinishDraftFlow } = await import('./FinishDraftFlow');
const { FirstPlanDraftFlow } = await import('../planning/FirstPlanDraftFlow');
const { SavePlaceFlow } = await import('../identity/SavePlaceFlow');
const { readDraft, saveDraft } = await import('../../data/draft');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
// Made at run time: a fixed secret-shaped literal is what a scanner looks for.
const SECRET = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function draftReady(way: 'ask' | 'invite' = 'ask') {
  await saveDraft({ circleName: 'Sunday Crew', cadence: 'fortnightly', way, proceed: true });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  Object.assign(session, { status: 'none', userId: undefined, isLoading: false });
  for (const mock of [push, replace, track, createCircle, createFirstPlan, ownProfile]) {
    mock.mockReset();
  }
  ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Europe/London' });
  createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
  createFirstPlan.mockResolvedValue({ plan_id: PLAN });
});

describe('the first circle, with no account', () => {
  it('holds the name and cadence as a draft and goes on, creating nothing', async () => {
    wrap(<FirstCircleFlow />);

    fireEvent.change(await screen.findByLabelText('Circle name'), {
      target: { value: ' Sunday  Crew ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Sunday Crew' }));
    });

    expect(push).toHaveBeenCalledWith('/circles/new/plan');
    expect(createCircle).not.toHaveBeenCalled();
    expect(await readDraft()).toMatchObject({ circleName: 'Sunday Crew', cadence: 'weekly' });
    expect(track).toHaveBeenCalledWith('organiser_draft_started', {});
  });

  it('offers a quiet Sign in to a returning organiser, and no account is asked for', async () => {
    wrap(<FirstCircleFlow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
    expect(screen.getByText('No account yet. You can change anything later.')).toBeVisible();
  });

  it('brings the draft back after a reload', async () => {
    await saveDraft({ circleName: 'Sunday Crew', cadence: 'weekly' });
    wrap(<FirstCircleFlow />);

    await waitFor(() => expect(screen.getByLabelText('Circle name')).toHaveValue('Sunday Crew'));
    expect(screen.getByRole('checkbox', { name: 'Weekly' })).toBeChecked();
  });

  it('refuses an unusable name without writing a draft', async () => {
    wrap(<FirstCircleFlow />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Create circle' }));
    });
    expect(screen.getByText('Give the circle a name of up to 40 characters.')).toBeVisible();
    expect(await readDraft()).toBeNull();
  });

  it('shows a signed-in organiser a way back and no Sign in', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    wrap(<FirstCircleFlow />);
    await screen.findByLabelText('Circle name');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
  });
});

describe('the first plan, drafted', () => {
  it('goes to the gate for somebody with no saved place, and creates nothing', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);

    expect(await screen.findByText('Most of the group need to make it')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    });

    expect(push).toHaveBeenCalledWith('/circles/new/save');
    expect(createCircle).not.toHaveBeenCalled();
    expect(createFirstPlan).not.toHaveBeenCalled();
    expect(await readDraft()).toMatchObject({ way: 'ask', proceed: false });
  });

  it('records Just invite people for now, which reaches the same gate', async () => {
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Most of the group need to make it');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Just invite people for now' }));
    });
    expect(push).toHaveBeenCalledWith('/circles/new/save');
    expect(await readDraft()).toMatchObject({ way: 'invite' });
  });

  it('skips the gate for a signed-in organiser', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    await screen.findByText('Most of the group need to make it');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    });
    expect(push).toHaveBeenCalledWith('/circles/new/finish');
    expect(await readDraft()).toMatchObject({ proceed: true });
  });

  it('keeps the preset picked, and a new key for the plan that it makes', async () => {
    const before = await saveDraft({ circleName: 'Sunday Crew' });
    wrap(<FirstPlanDraftFlow />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'This weekend' }));
    await waitFor(async () =>
      expect((await readDraft())?.keys.plan).not.toBe(before.draft.keys.plan),
    );
    expect(await readDraft()).toMatchObject({ preset: 'this_weekend' });
  });

  it('goes back to the first circle when there is no draft (expired or never made)', async () => {
    wrap(<FirstPlanDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });
});

describe('the finish', () => {
  it('makes the circle, then the plan, once each, and clears the draft', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    const { draft } = await saveDraft({ preset: 'this_weekend' });
    wrap(<FinishDraftFlow />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id: CIRCLE, planId: PLAN },
      }),
    );
    expect(createCircle).toHaveBeenCalledTimes(1);
    expect(createCircle).toHaveBeenCalledWith({
      name: 'Sunday Crew',
      cadence: 'fortnightly',
      timeZone: 'Europe/London',
      idempotencyKey: draft.keys.circle,
    });
    expect(createFirstPlan).toHaveBeenCalledWith(
      expect.objectContaining({ circleId: CIRCLE, preset: 'this_weekend' }),
    );
    expect(createCircle.mock.invocationCallOrder[0]!).toBeLessThan(
      createFirstPlan.mock.invocationCallOrder[0]!,
    );
    expect(track).toHaveBeenCalledWith('circle_created', { circle_id: CIRCLE });
    expect(await readDraft()).toBeNull();
    // The invite secret is held in memory and never put in the address.
    expect(JSON.stringify(replace.mock.calls)).not.toContain(SECRET);
  });

  it('with Just invite people, makes the circle and no plan, and opens its invite', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady('invite');
    wrap(<FinishDraftFlow />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/invite',
        params: { id: CIRCLE },
      }),
    );
    expect(createFirstPlan).not.toHaveBeenCalled();
  });

  it('keeps the draft when the plan fails, and Try again sends the same keys', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await draftReady();
    createFirstPlan.mockRejectedValueOnce(new Error('timeout'));
    wrap(<FinishDraftFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(replace).toHaveBeenCalled());

    const circleKeys = createCircle.mock.calls.map(
      ([o]) => (o as { idempotencyKey: string }).idempotencyKey,
    );
    const planKeys = createFirstPlan.mock.calls.map(
      ([o]) => (o as { idempotencyKey: string }).idempotencyKey,
    );
    expect(circleKeys).toHaveLength(2);
    expect(circleKeys[0]).toBe(circleKeys[1]);
    expect(planKeys).toHaveLength(2);
    expect(planKeys[0]).toBe(planKeys[1]);
    expect(await readDraft()).toBeNull();
  });

  it('asks for a name first when the account has none', async () => {
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
    expect(createFirstPlan).not.toHaveBeenCalled();
  });

  it('does nothing without a draft', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    wrap(<FinishDraftFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
    expect(createCircle).not.toHaveBeenCalled();
  });
});

describe('Save your place', () => {
  it('shows the plan that was drafted, and counts the gate shown once', async () => {
    await saveDraft({ circleName: 'Sunday Crew', way: 'ask' });
    const view = wrap(<SavePlaceFlow />);

    expect(await screen.findByText("Your plan's ready. Save your place.")).toBeVisible();
    expect(screen.getByText('Catch up · next 14 days')).toBeVisible();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SavePlaceFlow />
      </QueryClientProvider>,
    );
    const shown = track.mock.calls.filter(([name]) => name === 'organiser_gate_shown');
    expect(shown).toEqual([['organiser_gate_shown', {}]]);
    expect(createCircle).not.toHaveBeenCalled();
  });

  it('says it is a circle and an invite when that was the way chosen', async () => {
    await saveDraft({ circleName: 'Sunday Crew', way: 'invite' });
    wrap(<SavePlaceFlow />);
    expect(await screen.findByText("Your circle's ready. Save your place.")).toBeVisible();
  });

  it('goes back to the first circle when there is nothing to save', async () => {
    wrap(<SavePlaceFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
    expect(track).not.toHaveBeenCalledWith('organiser_gate_shown', expect.anything());
  });

  it('sends on somebody who is already signed in, without asking for anything', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    await saveDraft({ circleName: 'Sunday Crew', way: 'ask' });
    wrap(<SavePlaceFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
    expect(track).not.toHaveBeenCalledWith('organiser_gate_shown', expect.anything());
    expect(await readDraft()).toMatchObject({ proceed: true });
  });
});
