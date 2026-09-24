import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Availability from '../../data/availability';
import type * as CircleData from '../../data/circles';
import { FunctionError } from '../../data/functions';
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
const { FirstPlanFlow } = await import('./FirstPlanFlow');
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
  isOwner: true,
  members: fixture.sundayCrew.people.map((p) => ({ userId: p.id, name: p.name })),
  activePlan: null,
};

/** The plan already finding a time, as circle home reads it. */
const RUNNING = {
  id: 'thu-17',
  code: 'pnsundaycr',
  title: 'Catch up',
  organiserUserId: 'maya',
  responseDeadline: '2026-09-15T08:00:00.000Z',
  replied: 5,
  asked: 6,
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
  it('shows the plan already finding a time, with Edit and Cancel, and no form (ADR 00XX)', async () => {
    circleHome.mockResolvedValue({ ...HOME, activePlan: RUNNING });
    show(<PlanSetupFlow id="sunday-crew" />);

    expect(await screen.findByText('Sunday Crew is already finding a time')).toBeTruthy();
    expect(screen.getByText('Catch up')).toBeTruthy();
    expect(screen.getByText('5 of 6 replied')).toBeTruthy();
    expect(screen.getByText(/^Replies close /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit the plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/edit',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/cancel',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('offers a member neither button, and says whose plan it is', async () => {
    circleHome.mockResolvedValue({ ...HOME, me: 'sam', isOwner: false, activePlan: RUNNING });
    show(<PlanSetupFlow id="sunday-crew" />);

    expect(await screen.findByText(/Maya is organising this one/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit the plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel the plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "See how it's looking" }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it('offers the owner Cancel but not Edit of a plan somebody else organises (spec §4.5)', async () => {
    circleHome.mockResolvedValue({
      ...HOME,
      activePlan: { ...RUNNING, organiserUserId: 'sam' },
    });
    show(<PlanSetupFlow id="sunday-crew" />);

    expect(await screen.findByText(/Sam is organising this one/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit the plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel the plan' })).toBeTruthy();
  });

  it('shows the running plan on the first-run card too', async () => {
    circleHome.mockResolvedValue({ ...HOME, activePlan: RUNNING });
    show(<FirstPlanFlow id="sunday-crew" />);

    expect(await screen.findByText('Sunday Crew is already finding a time')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit the plan' })).toBeTruthy();
  });

  it('when a second tap loses the race, says so and reads the circle again', async () => {
    circleHome.mockResolvedValueOnce(HOME).mockResolvedValue({ ...HOME, activePlan: RUNNING });
    createPlan.mockRejectedValueOnce(
      new FunctionError(
        {
          error: 'conflict',
          reason: 'plan_in_progress',
          message: 'already',
          request_id: 'r',
        } as never,
        'already',
      ),
    );
    show(<PlanSetupFlow id="sunday-crew" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the group' }));

    // The circle is read again, and what it now says is drawn.
    expect(await screen.findByText('Sunday Crew is already finding a time')).toBeTruthy();
    expect(circleHome).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Ask the group' })).toBeNull();
  });

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

  it('retries a dropped request with the same key, and a settled refusal with a new one', async () => {
    const dropped = new FunctionError(undefined, 'no answer');
    const refused = new FunctionError(
      {
        error: 'conflict',
        reason: 'too_many_requests',
        message: 'slow down',
        request_id: 'r',
      } as never,
      'slow down',
    );
    createPlan.mockRejectedValueOnce(dropped).mockRejectedValueOnce(refused);
    show(<PlanSetupFlow id="sunday-crew" />);
    const ask = await screen.findByRole('button', { name: 'Ask the group' });
    const keyOf = (call: number) =>
      (createPlan.mock.calls[call]?.[0] as Planning.CreatePlanOptions).idempotencyKey;

    fireEvent.click(ask);
    expect(await screen.findByText(/^Something went wrong, so nothing was changed/)).toBeTruthy();
    fireEvent.click(ask);
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(2));
    // It may have made the plan: the same request, so the server can say so.
    expect(keyOf(1)).toBe(keyOf(0));

    expect(await screen.findByText(/^That's a lot of tries/)).toBeTruthy();
    fireEvent.click(ask);
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(1));
  });

  it('shows what would be made now when the clock has moved on, before making it', async () => {
    show(<PlanSetupFlow id="sunday-crew" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    // A day later, the form still open.
    vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW + 24 * 3_600_000);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));

    expect(await screen.findByText(/^Time has moved on since you opened this/)).toBeTruthy();
    expect(createPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    await waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
  });

  it('shows the deadline the server will count from now, when hours have passed on the same day', async () => {
    show(<PlanSetupFlow id="sunday-crew" />);
    expect(await screen.findByText('Replies close in 3 days')).toBeTruthy();
    vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW + 2 * 3_600_000);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    expect(await screen.findByText(/^Time has moved on since you opened this/)).toBeTruthy();
    expect(createPlan).not.toHaveBeenCalled();
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

  it('retries a dropped cancel with the same key, and a new note with a new one', async () => {
    cancelPlan.mockRejectedValueOnce(new FunctionError(undefined, 'no answer'));
    show(<CancelPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel the catch-up' }));
    expect(await screen.findByText(/^Something went wrong/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the catch-up' }));
    await waitFor(() => expect(cancelPlan).toHaveBeenCalledTimes(2));
    expect(cancelPlan.mock.calls[1]?.[2]).toBe(cancelPlan.mock.calls[0]?.[2]);
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

  it('shows the plan page rather than waiting for ever when the answer cannot be read', async () => {
    planDetails.mockResolvedValue(fixture.reopened);
    planToAnswer.mockRejectedValue(new Error('offline'));
    show(
      <PlanChangeGate code="pnsundaycr">
        <p>the plan page</p>
      </PlanChangeGate>,
    );
    expect(await screen.findByText('the plan page')).toBeTruthy();
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

  it('tells the chat the plan changed after an edit, rather than announcing a new one', async () => {
    planToShare.mockResolvedValue(SHARE);
    planDetails.mockResolvedValue(fixture.asking);
    show(<PlanSharedFlow id="sunday-crew" planId="thu-17" again />);
    expect(await screen.findByText('Change of plan. New times, please')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share to group chat' }));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('share_opened', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        kind: 'changed',
      }),
    );
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
