import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';
import type * as Planning from '../../data/planning';

/**
 * The organiser's first loop (S1-22): a circle, its invite, its home filling
 * up, a first plan and its message. What each screen sends, what it records,
 * and — the invariant that matters most here — that the invite secret goes
 * into the link and nowhere else.
 */

const push = vi.fn();
const replace = vi.fn();
const dismissTo = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo, back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
const ownProfile = vi.fn();
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    deviceTimeZone: () => 'Australia/Melbourne',
    ownProfile: () => ownProfile(),
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const createCircle = vi.fn();
const circleHome = vi.fn();
const fetchInviteSecret = vi.fn();
// The read itself, where it lives: `useCircle` calls it from inside the module,
// so mocking only the package's re-export would miss every screen that uses it.
vi.mock('../../data/circles/home', async (original) => ({
  ...(await original<typeof CircleHomeData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  createCircle: (...a: unknown[]) => createCircle(...a),
  fetchInviteSecret: (...a: unknown[]) => fetchInviteSecret(...a),
}));
const createFirstPlan = vi.fn();
const planToShare = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createFirstPlan: (...a: unknown[]) => createFirstPlan(...a),
  planToShare: (...a: unknown[]) => planToShare(...a),
}));
const shareMessage = vi.fn();
const copyText = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: (...a: unknown[]) => copyText(...a),
}));

const { FirstCircleFlow } = await import('./FirstCircleFlow');
const { InviteCircleFlow } = await import('./InviteCircleFlow');
const { CircleHomeFlow, JOINING_POLL_MS } = await import('./CircleHomeFlow');
const { FirstPlanFlow } = await import('../planning/FirstPlanFlow');
const { PlanSharedFlow } = await import('../planning/PlanSharedFlow');
const { keepInviteSecret } = await import('../../data/circles');
const { forgetInviteSecretsForTests } = await import('../../data/circles/invite');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
// Made at run time: a fixed secret-shaped literal is what a scanner looks for.
const SECRET = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

/** Fixed gaps, so "just joined" always lists Priya before Tom. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function home(overrides: Record<string, unknown> = {}) {
  return {
    id: CIRCLE,
    name: 'Sunday Crew',
    color: 'clay',
    status: 'active',
    nudgePolicy: null,
    defaultArea: null,
    cadence: 'monthly',
    zone: 'Australia/Melbourne',
    lastMetAt: null,
    cadenceSnoozedUntil: null,
    defaultDurationMinutes: 120,
    defaultQuorum: null,
    isOwner: true,
    me: 'maya',
    members: [
      { userId: 'maya', name: 'Maya', joinedAt: '2026-01-01T00:00:00Z', role: 'owner' },
      { userId: 'priya', name: 'Priya', joinedAt: minutesAgo(1), role: 'member' },
      { userId: 'tom', name: 'Tom', joinedAt: minutesAgo(2), role: 'member' },
    ],
    activePlan: null,
    lockedIn: null,
    morningAfter: null,
    myTurn: false,
    mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  Object.assign(session, { status: 'saved', userId: 'maya', isAnonymous: false });
  forgetInviteSecretsForTests();
  for (const mock of [
    push,
    replace,
    dismissTo,
    track,
    createCircle,
    circleHome,
    fetchInviteSecret,
    createFirstPlan,
    planToShare,
    shareMessage,
    copyText,
  ]) {
    mock.mockReset();
  }
  circleHome.mockResolvedValue(home());
  ownProfile.mockReset();
  ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
});

describe('FirstCircle', () => {
  it('makes the circle from the name and cadence, and goes on to the first plan', async () => {
    createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
    wrap(<FirstCircleFlow />);

    fireEvent.change(await screen.findByLabelText('Circle name'), {
      target: { value: ' Sunday  Crew ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fortnightly' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Sunday Crew' }));
    });

    expect(createCircle).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sunday Crew',
        cadence: 'fortnightly',
        timeZone: 'Australia/Melbourne',
      }),
    );
    expect(track).toHaveBeenCalledWith('circle_created', { circle_id: CIRCLE });
    // The plan, not the invite (ADR 0026): what the chat gets is one link with
    // a question in it.
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/new',
      params: { id: CIRCLE },
    });
    // The secret is held for the invite screen, never put in the address.
    expect(JSON.stringify(replace.mock.calls)).not.toContain(SECRET);
  });

  it('uses the zone chosen on Your name even when the profile is still loading (review round 1)', async () => {
    let answer: (profile: unknown) => void = () => undefined;
    ownProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
    wrap(<FirstCircleFlow />);

    fireEvent.change(await screen.findByLabelText('Circle name'), {
      target: { value: 'Sunday Crew' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Sunday Crew' }));
    });
    expect(createCircle).not.toHaveBeenCalled();

    await act(async () => {
      answer({ name: 'Maya', zone: 'Europe/London' });
    });
    await waitFor(() =>
      expect(createCircle).toHaveBeenCalledWith(
        expect.objectContaining({ timeZone: 'Europe/London' }),
      ),
    );
  });

  it('retries with the same key, so a second tap cannot make a second circle', async () => {
    createCircle.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({
      circle: { id: CIRCLE },
      invite_secret: SECRET,
    });
    wrap(<FirstCircleFlow />);
    fireEvent.change(await screen.findByLabelText('Circle name'), {
      target: { value: 'Sunday Crew' },
    });
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Create Sunday Crew' }));
      });
    }
    const keys = createCircle.mock.calls.map(
      ([o]) => (o as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('InviteCircle', () => {
  it('shows /join#secret and records how it was shared, never the link', async () => {
    keepInviteSecret(CIRCLE, SECRET);
    shareMessage.mockResolvedValue('sheet');
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText(`https://circles.test/join#${SECRET}`)).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share to group chat' }));
    });

    expect(shareMessage).toHaveBeenCalledWith(expect.stringContaining(`/join#${SECRET}`));
    expect(track).toHaveBeenCalledWith('circle_invite_shared', {
      circle_id: CIRCLE,
      kind: 'sheet',
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain(SECRET);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } }),
    );
  });

  it('copies where there is no share sheet, and says so', async () => {
    keepInviteSecret(CIRCLE, SECRET);
    copyText.mockResolvedValue(true);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    });
    expect(copyText).toHaveBeenCalledWith(`https://circles.test/join#${SECRET}`);
    // The Copy button says so itself, where the tap was (ADR 0026's share screen).
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(track).toHaveBeenCalledWith('circle_invite_shared', { circle_id: CIRCLE, kind: 'copy' });
  });

  it('after a reload, asks for the owner’s link again and shows it (ADR 0028)', async () => {
    fetchInviteSecret.mockImplementation((id: string) => {
      keepInviteSecret(id, SECRET);
      return Promise.resolve(SECRET);
    });
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText(`https://circles.test/join#${SECRET}`)).toBeVisible();
    expect(fetchInviteSecret).toHaveBeenCalledWith(CIRCLE);
  });

  it('says a link that cannot be shown again is gone, and offers the reset', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText(/can't be shown again/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Share to group chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open circle settings' }));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
  });

  it('never asks for a member who is not the owner', async () => {
    circleHome.mockResolvedValue(home({ isOwner: false }));
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText(/can't be shown again/)).toBeVisible();
    expect(fetchInviteSecret).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open circle settings' })).toBeNull();
  });
});

describe('the circle home', () => {
  it('shows who has just joined, and reads again every fifteen seconds while filling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wrap(<CircleHomeFlow id={CIRCLE} />);
      expect(await screen.findByText('Priya and Tom just joined')).toBeVisible();
      expect(screen.getByText('3 in so far · about monthly')).toBeVisible();

      const before = circleHome.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(JOINING_POLL_MS + 100);
      });
      await waitFor(() => expect(circleHome.mock.calls.length).toBeGreaterThan(before));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the plan that is finding a time, with its reply count', async () => {
    circleHome.mockResolvedValue(
      home({
        activePlan: {
          id: PLAN,
          code: 'abcdefgh',
          title: 'Catch up',
          responseDeadline: '2026-09-15T08:00:00Z',
          replied: 2,
          asked: 3,
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Finding a time')).toBeVisible();
    expect(screen.getByText('2 of 3 replied')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: "See how it's looking" }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: CIRCLE, planId: PLAN },
    });
  });
});

describe('the first plan', () => {
  it('previews the quorum over the members there are, and asks with the defaults', async () => {
    createFirstPlan.mockResolvedValue({ plan_id: PLAN, short_code: 'abcdefgh' });
    wrap(<FirstPlanFlow id={CIRCLE} />);

    expect(await screen.findByText('At least 3 of 3 need to make it')).toBeVisible();
    expect(screen.getByText('Adjusts as more people join')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    });

    // No quorum is sent: the server counts the members again when it is made.
    expect(createFirstPlan).toHaveBeenCalledWith(
      expect.not.objectContaining({ quorum: expect.anything() }),
    );
    expect(track).toHaveBeenCalledWith('plan_created', {
      circle_id: CIRCLE,
      plan_id: PLAN,
      mode: 'named',
      window: 'next_two_weeks',
      used_defaults: true,
    });
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/shared',
      params: { id: CIRCLE, planId: PLAN },
    });
  });

  it('offers this weekend and tonight too, and asks with the one picked (S2-06)', async () => {
    // A Tuesday morning in Melbourne, so the weekend has a full day of replies ahead of it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T00:00:00.000Z'));
    createFirstPlan.mockResolvedValue({ plan_id: PLAN, short_code: 'abcdefgh' });
    wrap(<FirstPlanFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByLabelText('This weekend'));
    expect(screen.getByText('Catch up · this weekend')).toBeVisible();
    expect(screen.getByText('Replies close in 24 hours')).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask the group' }));
    });

    expect(createFirstPlan).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'this_weekend' }),
    );
    expect(track).toHaveBeenCalledWith(
      'plan_created',
      expect.objectContaining({ window: 'weekend', used_defaults: false }),
    );
    vi.useRealTimers();
  });

  it('sends a guest member to save their place and back, not to a fixture (review round 4)', async () => {
    Object.assign(session, { status: 'guest', userId: 'priya', isAnonymous: true });
    wrap(<FirstPlanFlow id={CIRCLE} />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/sign-in',
        params: { next: `/circles/${CIRCLE}/plan/new` },
      }),
    );
    expect(replace).not.toHaveBeenCalledWith('/circles/gate');
    expect(createFirstPlan).not.toHaveBeenCalled();
  });
});

describe('the plan message', () => {
  const PLAN_TO_SHARE = {
    id: PLAN,
    code: 'abcdefgh',
    circleId: CIRCLE,
    circleName: 'Sunday Crew',
    zone: 'Australia/Melbourne',
    responseDeadline: '2026-09-15T08:00:00Z',
    windowStart: '2026-09-12',
    windowEnd: '2026-09-25',
  };

  it("is the domain's message with the plan's short link, and the way on is the editor", async () => {
    planToShare.mockResolvedValue(PLAN_TO_SHARE);
    copyText.mockResolvedValue(true);
    wrap(<PlanSharedFlow id={CIRCLE} planId={PLAN} />);

    const message = await screen.findByText(/When can Sunday Crew actually catch up\?/);
    expect(message).toHaveTextContent('in the next two weeks');
    // The link is its own line under the message, not buried inside it, and
    // the card shows what a chat will draw (S1-21's preview wording).
    expect(message).not.toHaveTextContent('https://circles.test/j/abcdefgh');
    expect(screen.getByText('https://circles.test/j/abcdefgh')).toBeVisible();
    expect(screen.getByText('Sunday Crew is finding a time to catch up')).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(track).toHaveBeenCalledWith('plan_shared', { circle_id: CIRCLE, plan_id: PLAN });

    // The organiser answers their own plan (ADR 0026), rather than ending on
    // the circle's home with nothing of theirs in it.
    fireEvent.click(screen.getByRole('button', { name: 'Add my times' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'abcdefgh' } });
    expect(dismissTo).not.toHaveBeenCalled();
  });

  it('offers the way on quietly until the message has left, then as a button', async () => {
    planToShare.mockResolvedValue(PLAN_TO_SHARE);
    copyText.mockResolvedValue(true);
    wrap(<PlanSharedFlow id={CIRCLE} planId={PLAN} />);

    await screen.findByRole('button', { name: 'Add my times' });
    // Copy confirms in place rather than in a notice somewhere else.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add my times' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'abcdefgh' } });
  });
});
