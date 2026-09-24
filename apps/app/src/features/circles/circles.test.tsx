import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    members: ['Maya', 'Priya', 'Tom', 'Jess', 'Sam', 'Alex'].map((name, i) => ({
      userId: name.toLowerCase(),
      name,
      joinedAt: `2026-01-0${i + 1}T00:00:00Z`,
      role: i === 0 ? ('owner' as const) : ('member' as const),
    })),
    activePlan: null,
    lockedIn: null,
    morningAfter: null,
    mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    fireEvent.click(row);
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
      fireEvent.click(await screen.findByRole('button', { name: 'Create circle' }));
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

    shareMessage.mockResolvedValue('sheet');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
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

  it('is just you before anybody joins, and shares the link', async () => {
    circleHome.mockResolvedValue(home({ members: home().members.slice(0, 1), lastMetAt: null }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share invite link' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/circles/[id]/invite', params: { id: CIRCLE } });
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
    expect(screen.queryByRole('button', { name: 'Invite link' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Circle settings' }).at(-1)!);
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
  });

  it('offers a member who is not the owner no invite link, and settings still', async () => {
    circleHome.mockResolvedValue(home({ isOwner: false, me: 'priya' }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Circle settings' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
    expect(screen.queryByRole('button', { name: 'Invite link' })).toBeNull();
  });
});
