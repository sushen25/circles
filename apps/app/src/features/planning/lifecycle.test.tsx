import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Availability from '../../data/availability';
import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';
import * as fixture from './fixtures';

/**
 * Making a plan, calling it off, and what the plan's link does once it is off
 * or reopened (S1-26). The server is mocked; what is asserted is what the
 * screens send and where they go.
 */

// The preview waits for the form to settle (`SETTLE_MS`) before it asks, so a
// full parallel run can take longer than the default second to show it.
configure({ asyncUtilTimeout: 5_000 });

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back, dismissTo: vi.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));

const circleHome = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const planDetails = vi.fn();
const createPlan = vi.fn();
const cancelPlan = vi.fn();
const planToShare = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  planToShare: (...a: unknown[]) => planToShare(...a),
  planDetails: (...a: unknown[]) => planDetails(...a),
  createPlan: (...a: unknown[]) => createPlan(...a),
  cancelPlan: (...a: unknown[]) => cancelPlan(...a),
}));
const planToAnswer = vi.fn();
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof Availability>()),
  planToAnswer: (...a: unknown[]) => planToAnswer(...a),
}));

const { PlanSetupFlow } = await import('./PlanSetupFlow');
const { CancelPlanFlow } = await import('./CancelPlanFlow');
const { CancelledFlow } = await import('./CancelledFlow');
const { PlanChangeGate } = await import('./MemberChangeFlow');
const { PlanSharedFlow } = await import('./PlanSharedFlow');

function show(
  node: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const HOME = {
  id: 'sunday-crew',
  name: 'Sunday Crew',
  zone: 'Australia/Melbourne',
  defaultDurationMinutes: 120,
  defaultQuorum: null,
  me: 'maya',
  members: fixture.sundayCrew.people.map((p) => ({ userId: p.id, name: p.name })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW);
  circleHome.mockResolvedValue(HOME);
  createPlan.mockResolvedValue({ plan_id: 'new-plan', short_code: 'pnnewplan' });
  cancelPlan.mockResolvedValue(undefined);
  shareMessage.mockResolvedValue('sheet');
});
afterEach(() => vi.restoreAllMocks());

describe('plan setup', () => {
  it('sends only what the organiser left alone as nothing, so the server resolves it', async () => {
    show(<PlanSetupFlow id="sunday-crew" />);
    expect(await screen.findByText('Replies close in 3 days')).toBeTruthy();
    expect(screen.getByText('At least 4 of 6 need to make it')).toBeTruthy();
    expect(screen.getByText('Adjusts as more people join')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    const sent = createPlan.mock.calls[0]?.[0] as Planning.CreatePlanOptions;
    expect(sent).toMatchObject({ preset: 'next_14_days', category: 'catch_up', title: 'Catch up' });
    // Untouched, so defaulted: the quorum follows the plan's audience (ADR 0026).
    expect(sent.quorum).toBeUndefined();
    expect(sent.responseDeadline).toBeUndefined();
    expect(sent.durationMinutes).toBeUndefined();
    expect(sent.requiredMemberIds).toBeUndefined();
    expect(track).toHaveBeenCalledWith('plan_created', {
      circle_id: 'sunday-crew',
      plan_id: 'new-plan',
      mode: 'named',
      window: 'next_two_weeks',
      used_defaults: true,
    });
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/shared',
      params: { id: 'sunday-crew', planId: 'new-plan' },
    });
  });

  it('sends what was changed, and says the defaults were not used', async () => {
    show(<PlanSetupFlow id="sunday-crew" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Dinner' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'This weekend' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '1.5 hrs' }));
    fireEvent.click(screen.getByRole('button', { name: 'One fewer person' }));
    // The weekend's own deadline, before the organiser moves it.
    expect(await screen.findByText('Replies close in 24 hours')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));

    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    expect(createPlan.mock.calls[0]?.[0]).toMatchObject({
      title: 'Dinner',
      category: 'dinner',
      preset: 'this_weekend',
      durationMinutes: 90,
      quorum: 3,
    });
    expect(track).toHaveBeenCalledWith(
      'plan_created',
      expect.objectContaining({ window: 'weekend', used_defaults: false }),
    );
  });

  it('hides tonight when it is too late for the meetup, rather than meaning tomorrow', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-15T12:50:00.000Z'));
    show(<PlanSetupFlow id="sunday-crew" />);
    const tonight = await screen.findByRole('checkbox', { name: 'Tonight' });
    expect(tonight.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('cancelling', () => {
  beforeEach(() => planDetails.mockResolvedValue(fixture.lockedIn));

  it('sends the note to the function and never to analytics, then shows the update', async () => {
    show(<CancelPlanFlow id="sunday-crew" planId="thu-17" />);
    expect(await screen.findByText("Cancel Thursday's catch-up?")).toBeTruthy();
    fireEvent.change(screen.getByLabelText('A short note, optional'), {
      target: { value: 'Work thing, sorry all.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the catch-up' }));

    await waitFor(() => expect(cancelPlan).toHaveBeenCalledTimes(1));
    expect(cancelPlan.mock.calls[0]?.slice(0, 2)).toEqual(['thu-17', 'Work thing, sorry all.']);
    expect(track).toHaveBeenCalledWith('plan_cancelled', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain('Work thing');
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/cancelled',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it("is the organiser's or the owner's, and nobody else's", async () => {
    planDetails.mockResolvedValue({ ...fixture.lockedIn, isOrganiser: false, isOwner: false });
    show(<CancelPlanFlow id="sunday-crew" planId="thu-17" />);
    expect(
      await screen.findByText("Only the organiser or the circle's owner can cancel this plan."),
    ).toBeTruthy();
  });

  it('gives the organiser the paste-ready update, and records the sheet opening', async () => {
    planDetails.mockResolvedValue(fixture.cancelled);
    show(<CancelledFlow id="sunday-crew" planId="thu-17" />);
    const update =
      "Update: Thursday's Sunday Crew catch-up is off. Work thing came up, sorry all. Will try again in October. https://circles.test/p/pnsundaycr";
    expect(await screen.findByText(update)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share to group chat' }));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledWith(update));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('share_opened', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        kind: 'cancelled',
      }),
    );
  });
});

describe("the plan's link, once the plan has changed", () => {
  it('sends a member of a cancelled plan to the cancelled screen', async () => {
    planDetails.mockResolvedValue(fixture.cancelledAsMember);
    show(
      <PlanChangeGate code="pnsundaycr">
        <p>the plan page</p>
      </PlanChangeGate>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/p/[code]/cancelled',
        params: { code: 'pnsundaycr' },
      }),
    );
  });

  it('says a reopen first to somebody who has not answered the new question', async () => {
    planDetails.mockResolvedValue(fixture.reopened);
    planToAnswer.mockResolvedValue({ plan: {}, answer: null });
    show(
      <PlanChangeGate code="pnsundaycr">
        <p>the plan page</p>
      </PlanChangeGate>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/p/[code]/rescheduled',
        params: { code: 'pnsundaycr' },
      }),
    );
  });

  it('leaves somebody who has answered on the plan page', async () => {
    planDetails.mockResolvedValue(fixture.reopened);
    planToAnswer.mockResolvedValue({ plan: {}, answer: { status: 'flexible', windows: [] } });
    show(
      <PlanChangeGate code="pnsundaycr">
        <p>the plan page</p>
      </PlanChangeGate>,
    );
    expect(await screen.findByText('the plan page')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('asking again', () => {
  const SHARE = {
    id: 'thu-17',
    code: 'pnsundaycr',
    circleId: 'sunday-crew',
    circleName: 'Sunday Crew',
    zone: 'Australia/Melbourne',
    responseDeadline: '2026-09-18T00:00:00.000Z',
    windowStart: '2026-09-18',
    windowEnd: '2026-10-01',
  };

  it('waits for the plan as the change left it, never the cached one from before', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // What the screen showed before the edit: the old deadline.
    client.setQueryData(['plan-to-share', 'thu-17', 'maya'], {
      ...SHARE,
      responseDeadline: '2026-09-15T08:00:00.000Z',
    });
    let answer: (value: unknown) => void = () => undefined;
    planToShare.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    planDetails.mockResolvedValue({
      ...fixture.reopened,
      me: 'maya',
      isOrganiser: true,
    });
    show(<PlanSharedFlow id="sunday-crew" planId="thu-17" again />, client);

    expect(await screen.findByText('Getting your plan')).toBeTruthy();
    // The other read is in; only the stale one is on hand for the share read.
    await waitFor(() => expect(planDetails).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Getting your plan')).toBeTruthy();
    expect(screen.queryByText(/Change of plan/)).toBeNull();
    answer(SHARE);
    expect(
      await screen.findByText('Change of plan: Thursday is off. New times, please'),
    ).toBeTruthy();
    expect(
      screen.getByText('Thursday is off. Send the link again so everyone can pick new times.'),
    ).toBeTruthy();
  });

  it('offers the cancel from the edit, for a plan still asking', async () => {
    planDetails.mockResolvedValue(fixture.asking);
    const { EditPlanFlow } = await import('./EditPlanFlow');
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/cancel',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });
});
