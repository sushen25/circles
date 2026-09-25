import { localDate } from '@circles/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';
import * as fixture from './fixtures';

/**
 * Plan another (S2-04, spec §5.9): the next plan, filled in from the last
 * meetup that happened, in one tap — and, beside a plan already finding a
 * time, that plan rather than a form (ADR 0033). The server is mocked; what is
 * asserted is what the screen sends and where it goes.
 */

configure({ asyncUtilTimeout: 5_000 });

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), dismissTo: vi.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = vi.hoisted(() => ({
  current: { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false },
}));
vi.mock('../../data/auth/session', () => ({ useSession: () => session.current }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const circleHome = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const createPlan = vi.fn();
const lastHappenedPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createPlan: (...a: unknown[]) => createPlan(...a),
  lastHappenedPlan: (...a: unknown[]) => lastHappenedPlan(...a),
}));

const { PlanAnotherFlow } = await import('./PlanAnotherFlow');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const HOME = {
  id: 'sunday-crew',
  name: 'Sunday Crew',
  zone: 'Australia/Melbourne',
  defaultDurationMinutes: 120,
  defaultQuorum: null,
  me: 'maya',
  isOwner: true,
  members: fixture.sundayCrew.people.map((p) => ({ userId: p.id, name: p.name })),
  activePlan: null,
};

/** September's dinner: a week of evenings, ninety minutes, and a quorum Maya chose. */
const SEPTEMBER: Planning.LastHappenedPlan = {
  category: 'dinner',
  durationMinutes: 90,
  quorum: 3,
  quorumChosen: true,
  window: { start: localDate('2026-09-07'), end: localDate('2026-09-13') },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  startsAt: '2026-09-10T08:30:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
  vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW);
  circleHome.mockResolvedValue(HOME);
  lastHappenedPlan.mockResolvedValue(SEPTEMBER);
  createPlan.mockResolvedValue({ plan_id: 'new-plan', short_code: 'pnnewplan' });
});
afterEach(() => vi.restoreAllMocks());

describe('Plan another', () => {
  it('is filled in from last time, and one tap asks the group with the same settings', async () => {
    show(<PlanAnotherFlow id="sunday-crew" />);

    expect(
      await screen.findByText("Filled in from September's catch-up. Change anything you like."),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Dinner' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Next 7 days' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByText(/^1\.5 hrs · /)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(createPlan.mock.calls[0]?.[0]).toMatchObject({
      circleId: 'sunday-crew',
      category: 'dinner',
      preset: 'next_7_days',
      durationMinutes: 90,
      quorum: 3,
    });
    // The suggested hours are the new window's own, not carried as a choice.
    expect((createPlan.mock.calls[0]?.[0] as Planning.CreatePlanOptions).daily).toBeUndefined();
    expect(track).toHaveBeenCalledWith('plan_another_started', { circle_id: 'sunday-crew' });
    expect(track).toHaveBeenCalledWith(
      'plan_created',
      expect.objectContaining({ used_defaults: true, window: 'next_week' }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id: 'sunday-crew', planId: 'new-plan' },
      }),
    );
  });

  it('leaves a quorum nobody chose to the server', async () => {
    lastHappenedPlan.mockResolvedValue({ ...SEPTEMBER, quorumChosen: false });
    show(<PlanAnotherFlow id="sunday-crew" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ask the group' }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect((createPlan.mock.calls[0]?.[0] as Planning.CreatePlanOptions).quorum).toBeUndefined();
  });

  it('says the defaults were not used once something was changed', async () => {
    show(<PlanAnotherFlow id="sunday-crew" />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Coffee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(createPlan.mock.calls[0]?.[0]).toMatchObject({ category: 'coffee' });
    expect(track).toHaveBeenCalledWith(
      'plan_created',
      expect.objectContaining({ used_defaults: false }),
    );
  });

  it('opens the full setup, filled in the same way, on Change', async () => {
    show(<PlanAnotherFlow id="sunday-crew" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));

    expect(await screen.findByText('Plan openly')).toBeTruthy();
    // The setup's heading is the category it was opened with.
    expect(screen.getAllByText('Dinner').length).toBeGreaterThan(1);
  });

  it('meets a plan already finding a time with that plan, and no form (ADR 0033)', async () => {
    circleHome.mockResolvedValue({
      ...HOME,
      activePlan: {
        id: 'thu-17',
        code: 'pnsundaycr',
        title: 'Catch up',
        organiserUserId: 'maya',
        responseDeadline: '2026-09-17T08:00:00.000Z',
        replied: 5,
        asked: 6,
      },
    });
    show(<PlanAnotherFlow id="sunday-crew" />);

    expect(await screen.findByText('Sunday Crew is already finding a time')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit the plan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();
    expect(track).not.toHaveBeenCalledWith('plan_another_started', expect.anything());
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('is the ordinary setup for a circle whose meetups have never happened', async () => {
    lastHappenedPlan.mockResolvedValue(null);
    show(<PlanAnotherFlow id="sunday-crew" />);

    expect(await screen.findByText('Plan openly')).toBeTruthy();
  });

  it('sends a guest member to save their place, and brings them back here', async () => {
    session.current = { status: 'guest', userId: 'alex', isAnonymous: true, isLoading: false };
    circleHome.mockResolvedValue({ ...HOME, me: 'alex', isOwner: false });
    show(<PlanAnotherFlow id="sunday-crew" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/sign-in',
        params: { next: '/circles/sunday-crew/plan/another' },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();
  });
});
