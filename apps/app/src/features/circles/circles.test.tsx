import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';
import type * as CircleListData from '../../data/circles/list';

/**
 * S1-23: the circles list, creating a second circle, and circle home in each of
 * its states from the data — which is the domain's call, not the screen's.
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
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    deviceTimeZone: () => 'Australia/Melbourne',
    ownProfile: () => Promise.resolve({ name: 'Maya', zone: 'Australia/Melbourne' }),
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));

const circleHome = vi.fn();
vi.mock('../../data/circles/home', async (original) => ({
  ...(await original<typeof CircleHomeData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const circlesList = vi.fn();
vi.mock('../../data/circles/list', async (original) => ({
  ...(await original<typeof CircleListData>()),
  circlesList: () => circlesList(),
}));
const createCircle = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  createCircle: (...a: unknown[]) => createCircle(...a),
}));

const { CirclesListFlow } = await import('./CirclesListFlow');
const { CreateCircleFlow } = await import('./CreateCircleFlow');
const { CircleHomeFlow } = await import('./CircleHomeFlow');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
const SECRET = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

function home(overrides: Partial<CircleData.CircleHome> = {}): CircleData.CircleHome {
  return {
    id: CIRCLE,
    name: 'Sunday Crew',
    color: 'clay',
    status: 'active',
    cadence: 'monthly',
    nudgePolicy: null,
    defaultArea: null,
    zone: 'Australia/Melbourne',
    lastMetAt: '2026-08-08T08:30:00Z',
    cadenceSnoozedUntil: null,
    defaultDurationMinutes: 120,
    defaultQuorum: null,
    isOwner: true,
    me: 'maya',
    members: ['Maya', 'Nina', 'Tom', 'Jess', 'Sam', 'Alex'].map((name, i) => ({
      userId: name.toLowerCase(),
      name,
      joinedAt: `2026-01-0${i + 1}T00:00:00Z`,
      role: i === 0 ? ('owner' as const) : ('member' as const),
      savedPlace: true,
    })),
    activePlan: null,
    lockedIn: null,
    morningAfter: null,
    myTurn: false,
    mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
    ...overrides,
  };
}

function wrap(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  for (const mock of [push, replace, track, shareMessage, circleHome, circlesList, createCircle]) {
    mock.mockReset();
  }
});

describe('the circles list', () => {
  it('is the first-run variant when there are none, and starts the first run', async () => {
    circlesList.mockResolvedValue([]);
    wrap(<CirclesListFlow />);

    expect(await screen.findByText('How it goes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first circle' }));
    expect(push).toHaveBeenCalledWith('/circles/new');
  });

  it('lists each circle with its line, and opens it by its real id', async () => {
    circlesList.mockResolvedValue([
      {
        id: CIRCLE,
        name: 'Sunday Crew',
        color: 'clay',
        status: 'active',
        cadence: 'monthly',
        zone: 'Australia/Melbourne',
        lastMetAt: null,
        cadenceSnoozedUntil: null,
        defaultDurationMinutes: 120,
        memberCount: 6,
        isOwner: true,
        activePlan: { replied: 5, asked: 6 },
        lockedIn: null,
      },
    ]);
    wrap(<CirclesListFlow />);

    // The row's spoken name carries its line too, not just the title (S1-27).
    const row = await screen.findByRole('button', {
      name: 'Sunday Crew. Finding a time · 5 of 6 replied',
    });
    await tap(row);
    expect(push).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } });

    fireEvent.click(screen.getByRole('button', { name: 'New circle' }));
    expect(push).toHaveBeenCalledWith('/circles/create');
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(push).toHaveBeenCalledWith('/settings/account');
  });

  it('says it could not load, and tries again', async () => {
    circlesList.mockRejectedValueOnce(new Error('circle lookup failed'));
    wrap(<CirclesListFlow />);

    expect(await screen.findByText("We couldn't load your circles.")).toBeVisible();
  });
});

describe('CreateCircle', () => {
  it('sends the name, colour, cadence and area, and opens the new circle', async () => {
    createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: SECRET });
    wrap(<CreateCircleFlow />);

    fireEvent.change(await screen.findByLabelText('Circle name'), {
      target: { value: 'Book Club' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Plum' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fortnightly' }));
    fireEvent.change(screen.getByLabelText('Where, roughly'), {
      target: { value: 'Inner north' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create circle' }));
    });

    await waitFor(() =>
      expect(createCircle).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Book Club',
          color: 'plum',
          cadence: 'fortnightly',
          area: 'Inner north',
          timeZone: 'Australia/Melbourne',
        }),
      ),
    );
    expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } });
    expect(JSON.stringify(track.mock.calls)).not.toContain(SECRET);
  });

  it('asks for a name rather than sending none', async () => {
    wrap(<CreateCircleFlow />);
    await act(async () => {
      await tap(screen.findByRole('button', { name: 'Create circle' }));
    });
    expect(screen.getByText(/A name needs a letter or two/)).toBeVisible();
    expect(createCircle).not.toHaveBeenCalled();
  });
});

describe('circle home, in the state the data puts it in', () => {
  it('is locked in with a meetup ahead: the date, who is going, and Details', async () => {
    circleHome.mockResolvedValue(
      home({
        lockedIn: {
          planId: PLAN,
          code: 'pnsundaycr',
          startsAt: '2026-09-17T08:30:00Z',
          endsAt: '2026-09-17T10:30:00Z',
          placeName: 'Hope St Radio',
          going: 5,
          toConfirm: 1,
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Locked in')).toBeVisible();
    expect(screen.getByText('5 going · 1 to confirm')).toBeVisible();
    expect(screen.getByText(/Hope St Radio$/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: CIRCLE, planId: PLAN },
    });
    // Planning another stays reachable, as the quiet action beneath (SUS-197).
    expect(screen.getByRole('button', { name: 'Plan another' })).toBeVisible();
    // The plan's link turns newcomers away once it is locked in, so the card's
    // action is for people already in, and adding someone is the members'.
    expect(screen.getByText('For people already in Sunday Crew.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();

    shareMessage.mockResolvedValue('sheet');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send the details' }));
    });
    expect(shareMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Locked in: Sunday Crew, .* at Hope St Radio\. .*\/j\/pnsundaycr$/),
    );
  });

  it('is about time when the cadence says so, and counts nothing', async () => {
    circleHome.mockResolvedValue(home({ lastMetAt: '2026-01-01T08:30:00Z' }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('About time for the next one')).toBeVisible();
    expect(screen.getByText(/It's been about a month since Sunday Crew/)).toBeVisible();
  });

  it('is just you before anybody joins: plan a catch-up leads, Add someone is with the members', async () => {
    circleHome.mockResolvedValue(home({ members: home().members.slice(0, 1), lastMetAt: null }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Just you so far')).toBeVisible();
    expect(
      screen.getByText('Plan a catch-up and share it. Friends join from the plan.'),
    ).toBeVisible();
    // Nothing has happened yet, so nothing to say of last time or next time.
    expect(screen.queryByText('Last caught up')).toBeNull();
    expect(screen.queryByText('Next one')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/circles/[id]/invite',
      params: { id: CIRCLE },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan a catch-up' }));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/circles/[id]/plan/new',
      params: { id: CIRCLE },
    });
  });

  it('is archived before any other state: no plan, no link, only the way back', async () => {
    circleHome.mockResolvedValue(
      home({
        status: 'archived',
        activePlan: {
          id: PLAN,
          code: 'pnsundaycr',
          organiserUserId: 'maya',
          title: 'Catch up',
          responseDeadline: '2026-09-29T08:00:00Z',
          replied: 1,
          asked: 6,
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Archived. Nobody gets prompts about it.')).toBeVisible();
    expect(screen.queryByText('Finding a time')).toBeNull();
    expect(screen.queryByRole('button', { name: /Plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Circle settings' }).at(-1)!);
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
  });

  it('offers a member who is not the owner Add someone, between plans, and settings', async () => {
    circleHome.mockResolvedValue(home({ isOwner: false, me: 'nina' }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Circle settings' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }));
    expect(push).toHaveBeenLastCalledWith({
      pathname: '/circles/[id]/invite',
      params: { id: CIRCLE },
    });
  });
});

/** Twenty active members: the cap (ADR 0012), with Nina's circle owned by Maya. */
function fullHome(overrides: Partial<CircleData.CircleHome> = {}): CircleData.CircleHome {
  return home({
    name: 'Thursday Lot',
    members: Array.from({ length: 20 }, (_, i) => ({
      userId: i === 0 ? 'maya' : `m${i}`,
      name: i === 0 ? 'Maya' : i === 1 ? 'Nina' : `Guest ${i}`,
      joinedAt: '2026-01-01T00:00:00Z',
      role: i === 0 ? ('owner' as const) : ('member' as const),
      savedPlace: true,
    })),
    ...overrides,
  });
}

describe('circle home at the member cap (SUS-199)', () => {
  it('says the circle is full where it filled up, and offers no way to add anyone', async () => {
    circleHome.mockResolvedValue(fullHome({ lastMetAt: null }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    // "In so far" promises more to come.
    expect(screen.queryByText(/in so far/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
    // The way forward is still the plan, and settings.
    expect(screen.getByRole('button', { name: 'Plan the first catch-up' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Circle settings' })).toBeVisible();
  });

  it('says it beside the members, with Add someone gone, in every other state', async () => {
    circleHome.mockResolvedValue(fullHome());
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    expect(screen.queryByText('20 members')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
  });

  it('is only said at the cap: nineteen still offer Add someone', async () => {
    const nineteen = fullHome();
    circleHome.mockResolvedValue({ ...nineteen, members: nineteen.members.slice(0, 19) });
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Add someone' })).toBeVisible();
    expect(screen.queryByText(/is full/)).toBeNull();
  });

  it('is not said of an archived circle', async () => {
    circleHome.mockResolvedValue(fullHome({ status: 'archived' }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Archived. Nobody gets prompts about it.')).toBeVisible();
    expect(screen.queryByText(/is full/)).toBeNull();
  });
});

describe('circle home and the quiet ask (S2-03)', () => {
  const RUNNING = {
    id: PLAN,
    code: 'pnsundaycr',
    organiserUserId: 'maya',
    title: 'Catch up',
    // Still asking whenever this runs.
    responseDeadline: '2099-09-29T08:00:00Z',
    replied: 1,
    asked: 6,
  };
  const ASK = { planId: '00000000-0000-4000-8000-00000000a5c1', closesAt: '2026-09-18T02:00:00Z' };

  it('shows an ask still asking as one card, the same for whoever reads it', async () => {
    // Maya is the owner and Tom is not; neither card may say whose it is.
    const seen: string[] = [];
    for (const reader of ['maya', 'tom']) {
      circleHome.mockResolvedValue(
        home({ me: reader, isOwner: reader === 'maya', quietAsks: [ASK] }),
      );
      const { unmount } = wrap(<CircleHomeFlow id={CIRCLE} />);
      expect(await screen.findByText('Asked quietly')).toBeVisible();
      seen.push(screen.getByText('Asked quietly').parentElement?.parentElement?.textContent ?? '');
      fireEvent.click(screen.getByRole('button', { name: 'Take a look' }));
      expect(push).toHaveBeenLastCalledWith({
        pathname: '/circles/[id]/quiet/[planId]',
        params: { id: CIRCLE, planId: ASK.planId },
      });
      unmount();
    }
    expect(seen[0]).toBe(seen[1]);
  });

  it('says "started quietly" while nobody has taken it on, and leads to the quiet screens', async () => {
    circleHome.mockResolvedValue(
      home({ activePlan: { ...RUNNING, organiserUserId: null, quiet: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Started quietly')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: "See how it's looking" }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/quiet/[planId]',
      params: { id: CIRCLE, planId: PLAN },
    });
  });

  it("leads with the plan's own action and offers no second plan beside it (SUS-197, ADR 0033)", async () => {
    circleHome.mockResolvedValue(home({ activePlan: RUNNING }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await screen.findAllByText('Finding a time');
    expect(screen.queryByRole('button', { name: 'Plan a catch-up' })).toBeNull();
    // One "See how it's looking", and it is the screen's primary.
    fireEvent.click(screen.getByRole('button', { name: "See how it's looking" }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: CIRCLE, planId: PLAN },
    });
  });

  it('says the next one is the plan, not "No rush"', async () => {
    circleHome.mockResolvedValue(home({ activePlan: RUNNING }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await screen.findByText('Next one');
    expect(screen.queryByText('No rush')).toBeNull();
    expect(screen.getAllByText('Finding a time')).toHaveLength(2);
  });
});

describe('circle home, for somebody whose times an edit cleared (SUS-130)', () => {
  const RUNNING = {
    id: PLAN,
    code: 'pnsundaycr',
    organiserUserId: 'maya',
    title: 'Catch up',
    // Still asking whenever this runs.
    responseDeadline: '2099-09-29T08:00:00Z',
    replied: 1,
    asked: 6,
  };
  const CLEARED =
    'The plan changed, so the times you sent were cleared. Add yours again so they count.';

  it('says the plan changed and their times need adding again, on the plan card', async () => {
    circleHome.mockResolvedValue(
      home({ me: 'nina', isOwner: false, activePlan: { ...RUNNING, askedAgain: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText(CLEARED)).toBeVisible();
    expect(screen.getAllByText('Finding a time')[0]).toBeVisible();
  });

  // Review round 2: the line asks for their times, so the card's button is the
  // way to give them. The organiser's candidates screen has no editor link, so
  // without this an organiser told to add theirs again had nowhere to do it.
  it.each([
    ['a member', 'nina'],
    ['the organiser, whose own edit cleared theirs,', 'maya'],
  ])('takes %s from the card to the grid', async (_who, me) => {
    circleHome.mockResolvedValue(
      home({ me, isOwner: me === 'maya', activePlan: { ...RUNNING, askedAgain: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Add my times' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'pnsundaycr' } });
    expect(screen.queryByRole('button', { name: "See how it's looking" })).toBeNull();
  });

  // Review round 3: the grid's read is kept for 30 seconds, and one from before
  // the edit would open on the answer the edit cleared. Circle home has just
  // been told by the server that it is out of date, so it is.
  it('does not let the grid open on an answer read before the edit', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const before = ['plan-to-answer', 'pnsundaycr', 'nina'];
    client.setQueryData(before, { answer: { status: 'flexible' } });
    circleHome.mockResolvedValue(
      home({ me: 'nina', isOwner: false, activePlan: { ...RUNNING, askedAgain: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />, client);

    await tap(screen.findByRole('button', { name: 'Add my times' }));
    expect(client.getQueryState(before)?.isInvalidated).toBe(true);
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'pnsundaycr' } });
  });

  it('says nothing of the kind to somebody it did not happen to', async () => {
    circleHome.mockResolvedValue(
      home({ me: 'alex', isOwner: false, activePlan: { ...RUNNING, askedAgain: false } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect((await screen.findAllByText('Finding a time'))[0]).toBeVisible();
    expect(screen.queryByText(CLEARED)).toBeNull();
    expect(screen.getByRole('button', { name: "See how it's looking" })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add my times' })).toBeNull();
  });
});

describe('circle home, sharing the plan again (SUS-132, SUS-248)', () => {
  const OPEN = () => ({
    id: PLAN,
    code: 'pnsundaycr',
    organiserUserId: 'maya',
    title: 'Catch up',
    // Relative, so the plan is open whenever this runs.
    responseDeadline: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    replied: 2,
    asked: 6,
  });
  const SHARE = { name: 'Share the plan' };

  it('gives the organiser the plan link in one tap, as a count and never names', async () => {
    shareMessage.mockResolvedValue('sheet');
    circleHome.mockResolvedValue(home({ activePlan: OPEN() }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledTimes(1));
    const message = shareMessage.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/waiting on 4 replies .*\/j\/pnsundaycr$/);
    for (const name of ['Nina', 'Tom', 'Jess', 'Sam', 'Alex']) expect(message).not.toContain(name);
    expect(track).toHaveBeenCalledWith(
      'share_opened',
      expect.objectContaining({ circle_id: CIRCLE, plan_id: PLAN, kind: 'reminder' }),
    );
  });

  it('says so when it copied instead of opening a share sheet', async () => {
    shareMessage.mockResolvedValue('copied');
    circleHome.mockResolvedValue(home({ activePlan: OPEN() }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', SHARE));
    expect(await screen.findByText('Copied. Paste it in the group chat.')).toBeVisible();
  });

  it('says so when it could not copy, and does not count it as shared', async () => {
    shareMessage.mockResolvedValue('failed');
    circleHome.mockResolvedValue(home({ activePlan: OPEN() }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', SHARE));
    expect(await screen.findByText("Couldn't copy the message. Try again.")).toBeVisible();
    expect(track).not.toHaveBeenCalledWith('share_opened', expect.anything());
  });

  it('is not offered once the deadline has passed', async () => {
    circleHome.mockResolvedValue(
      home({
        activePlan: {
          ...OPEN(),
          responseDeadline: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Replies closed')).toBeVisible();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('is not offered on a quiet ask nobody has taken on', async () => {
    circleHome.mockResolvedValue(
      home({ activePlan: { ...OPEN(), organiserUserId: null, quiet: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Started quietly')).toBeVisible();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('is offered once somebody has taken a quiet ask on', async () => {
    shareMessage.mockResolvedValue('sheet');
    circleHome.mockResolvedValue(home({ activePlan: { ...OPEN(), quiet: true } }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledTimes(1));
  });

  it('is not offered where the plan is locked in, which has its own Share', async () => {
    circleHome.mockResolvedValue(
      home({
        lockedIn: {
          planId: PLAN,
          code: 'pnsundaycr',
          startsAt: '2026-10-17T08:30:00Z',
          endsAt: '2026-10-17T10:30:00Z',
          placeName: 'Hope St Radio',
          going: 5,
          toConfirm: 1,
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Locked in')).toBeVisible();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('is offered to a member who is not organising it, with the same count-only message', async () => {
    // The founder's decision, 1 October 2026: any member may forward the link.
    shareMessage.mockResolvedValue('sheet');
    circleHome.mockResolvedValue(home({ me: 'nina', isOwner: false, activePlan: OPEN() }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledTimes(1));
    const message = shareMessage.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/waiting on 4 replies .*\/j\/pnsundaycr$/);
    expect(message).not.toContain('Alex');
  });

  it('is not offered to a member once the deadline has passed', async () => {
    circleHome.mockResolvedValue(
      home({
        me: 'nina',
        isOwner: false,
        activePlan: {
          ...OPEN(),
          responseDeadline: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Replies closed')).toBeVisible();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('is not offered to a member on a quiet ask', async () => {
    circleHome.mockResolvedValue(
      home({
        me: 'nina',
        isOwner: false,
        activePlan: { ...OPEN(), organiserUserId: null, quiet: true },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText('Started quietly')).toBeVisible();
    expect(screen.queryByRole('button', SHARE)).toBeNull();
  });

  it('sits beside "Add my times" while the times-cleared line shows, and sends the same message', async () => {
    shareMessage.mockResolvedValue('sheet');
    circleHome.mockResolvedValue(
      home({ me: 'nina', isOwner: false, activePlan: { ...OPEN(), askedAgain: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Add my times' })).toBeVisible();
    expect(screen.queryByRole('button', { name: "See how it's looking" })).toBeNull();
    fireEvent.click(screen.getByRole('button', SHARE));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledTimes(1));
    expect(shareMessage.mock.calls[0]?.[0] as string).toMatch(/waiting on 4 replies/);
  });

  it('goes at the deadline, on a home left open across it', async () => {
    circleHome.mockResolvedValue(
      home({
        activePlan: { ...OPEN(), responseDeadline: new Date(Date.now() + 400).toISOString() },
      }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', SHARE)).toBeVisible();
    // While the plan asks there is one way into the chat, and no Add someone...
    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
    // ...and at the deadline the card stops sharing and Add someone takes over.
    await waitFor(() => expect(screen.queryByRole('button', SHARE)).toBeNull());
    expect(await screen.findByRole('button', { name: 'Add someone' })).toBeVisible();
    expect(screen.getByText('Replies closed')).toBeVisible();
  });
});

/**
 * SUS-248 (ADR 0091): one way into the chat for each job. The rule table, for
 * the owner and for a member, in every state of the home.
 */
describe('circle home: one way into the chat at a time (SUS-248)', () => {
  const day = 24 * 3600 * 1000;
  const PLAN_OPEN = () => ({
    id: PLAN,
    code: 'pnsundaycr',
    organiserUserId: 'maya',
    title: 'Catch up in the next 14 days',
    responseDeadline: new Date(Date.now() + 3 * day).toISOString(),
    replied: 5,
    asked: 6,
  });
  const PLAN_CLOSED = () => ({
    ...PLAN_OPEN(),
    responseDeadline: new Date(Date.now() - 3600 * 1000).toISOString(),
  });
  const LOCKED = {
    planId: PLAN,
    code: 'pnsundaycr',
    startsAt: '2026-10-17T08:30:00Z',
    endsAt: '2026-10-17T10:30:00Z',
    placeName: 'Hope St Radio',
    going: 5,
    toConfirm: 1,
  };
  const ONLY_MAYA = () => home().members.slice(0, 1);
  // Nina and Tom came in this hour, so they "just joined".
  const JOINING = () =>
    ['Maya', 'Nina', 'Tom'].map((name, i) => ({
      userId: name.toLowerCase(),
      name,
      joinedAt: i === 0 ? '2026-01-01T00:00:00Z' : new Date(Date.now() - 3600 * 1000).toISOString(),
      role: i === 0 ? ('owner' as const) : ('member' as const),
      savedPlace: true,
    }));

  const readers = [
    ['the owner', { isOwner: true, me: 'maya' }],
    ['a member', { isOwner: false, me: 'nina' }],
  ] as const;

  const NEVER = { name: /link/i };

  describe.each(readers)('as %s', (_who, reader) => {
    it('Finding a time: the card is titled by its state and offers Share the plan, and no Add someone', async () => {
      circleHome.mockResolvedValue(home({ ...reader, activePlan: PLAN_OPEN() }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect((await screen.findAllByText('Finding a time'))[0]).toBeVisible();
      expect(screen.getByText(/^Replies close /)).toBeVisible();
      expect(screen.getByText('5 of 6 replied')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Share the plan' })).toBeVisible();
      expect(screen.getByText('Anyone new can join from it too.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
      expect(screen.getByRole('button', { name: "See how it's looking" })).toBeVisible();
      expect(screen.queryByRole('button', NEVER)).toBeNull();
    });

    it('Locked in: Send the details, for people already in, and Add someone with the members', async () => {
      circleHome.mockResolvedValue(home({ ...reader, lockedIn: LOCKED }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Locked in')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Send the details' })).toBeVisible();
      expect(screen.getByText('For people already in Sunday Crew.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Details' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Plan another' })).toBeVisible();
      expect(screen.queryByRole('button', NEVER)).toBeNull();
    });

    it('About time: the nudge as before, Add someone, and Plan another', async () => {
      circleHome.mockResolvedValue(home({ ...reader, lastMetAt: '2026-01-01T08:30:00Z' }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('About time for the next one')).toBeVisible();
      expect(screen.getByText('Last caught up')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Plan another' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Share the plan' })).toBeNull();
      expect(screen.queryByRole('button', NEVER)).toBeNull();
    });

    it('Between catch-ups: Add someone, and Plan a catch-up', async () => {
      circleHome.mockResolvedValue(home({ ...reader, lastMetAt: new Date().toISOString() }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Plan a catch-up' })).toBeVisible();
      expect(screen.queryByRole('button', NEVER)).toBeNull();
    });

    it('Just you: the plan is how friends join, Add someone sits with the marks', async () => {
      circleHome.mockResolvedValue(home({ ...reader, members: ONLY_MAYA(), lastMetAt: null }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Just you so far')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Plan a catch-up' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.queryByText('Last caught up')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Share again' })).toBeNull();
      expect(screen.queryByRole('button', NEVER)).toBeNull();
    });
  });

  describe('Replies closed', () => {
    it('tells the organiser it is time to pick one, and leads with Pick a time', async () => {
      circleHome.mockResolvedValue(home({ activePlan: PLAN_CLOSED() }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Replies closed')).toBeVisible();
      expect(screen.getByText('Time to pick one')).toBeVisible();
      expect(screen.getByText('5 of 6 replied')).toBeVisible();
      // The card shares nothing: the plan admits nobody now.
      expect(screen.queryByRole('button', { name: 'Share the plan' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.queryByRole('button', { name: "See how it's looking" })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Pick a time' }));
      expect(push).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/candidates',
        params: { id: CIRCLE, planId: PLAN },
      });
    });

    it('tells a member who picks next, and leads with how it is looking', async () => {
      circleHome.mockResolvedValue(home({ isOwner: false, me: 'nina', activePlan: PLAN_CLOSED() }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Replies closed')).toBeVisible();
      expect(screen.getByText('Maya picks a time next')).toBeVisible();
      expect(screen.getByRole('button', { name: "See how it's looking" })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Pick a time' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Share the plan' })).toBeNull();
    });

    it('does not offer Add my times to somebody whose times were cleared: nothing takes them now', async () => {
      circleHome.mockResolvedValue(
        home({
          isOwner: false,
          me: 'nina',
          activePlan: { ...PLAN_CLOSED(), askedAgain: true },
        }),
      );
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Replies closed')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add my times' })).toBeNull();
    });
  });

  describe('New people joined', () => {
    it('names them in the title, goes without Share again, and leads with the first plan', async () => {
      circleHome.mockResolvedValue(home({ members: JOINING(), lastMetAt: null }));
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('Nina and Tom just joined')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Share again' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Plan the first catch-up' })).toBeVisible();
      expect(screen.queryByText('Last caught up')).toBeNull();
    });

    it('reads "You and Tom just joined" to a member who is one of them', async () => {
      circleHome.mockResolvedValue(
        home({ isOwner: false, me: 'nina', members: JOINING(), lastMetAt: null }),
      );
      wrap(<CircleHomeFlow id={CIRCLE} />);

      expect(await screen.findByText('You and Tom just joined')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
    });
  });

  it('a member adds someone between plans, from the home to the Add someone screen', async () => {
    circleHome.mockResolvedValue(
      home({ isOwner: false, me: 'nina', lastMetAt: '2026-10-01T00:00:00Z' }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Add someone' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/circles/[id]/invite', params: { id: CIRCLE } });
  });

  it('says the last caught up and next one only once the circle has met', async () => {
    circleHome.mockResolvedValue(home({ activePlan: PLAN_OPEN(), lastMetAt: null }));
    wrap(<CircleHomeFlow id={CIRCLE} />);
    expect((await screen.findAllByText('Finding a time'))[0]).toBeVisible();
    expect(screen.queryByText('Last caught up')).toBeNull();
    expect(screen.queryByText('Next one')).toBeNull();
  });
});
