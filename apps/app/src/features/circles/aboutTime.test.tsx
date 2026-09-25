import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';
import type * as CircleSettings from '../../data/circles/settings';

/**
 * S2-04: circle home's about-time card — "it's your turn" to the one person the
 * nudge asked, Snooze a month for the owner, Turn off nudges for the reader —
 * and Plan another as its one action.
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
const updateCircle = vi.fn();
const saveMySwitches = vi.fn();
vi.mock('../../data/circles/settings', async (original) => ({
  ...(await original<typeof CircleSettings>()),
  updateCircle: (...a: unknown[]) => updateCircle(...a),
  saveMySwitches: (...a: unknown[]) => saveMySwitches(...a),
}));

const { CircleHomeFlow } = await import('./CircleHomeFlow');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';

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
  for (const mock of [
    push,
    replace,
    track,
    shareMessage,
    circleHome,
    updateCircle,
    saveMySwitches,
  ]) {
    mock.mockReset();
  }
  updateCircle.mockResolvedValue(undefined);
  saveMySwitches.mockResolvedValue(undefined);
});

/** Monthly, and last met in January: about time, whenever this runs. */
const due = (overrides: Partial<CircleData.CircleHome> = {}) =>
  home({ lastMetAt: '2026-01-01T08:30:00Z', ...overrides });

describe('the about-time card', () => {
  it('tells the one person the nudge asked that it is their turn', async () => {
    circleHome.mockResolvedValue(due({ myTurn: true }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText(/It's your turn to plan, if the group's keen/)).toBeVisible();
  });

  it('says the quieter sentence to everybody else, naming nobody', async () => {
    circleHome.mockResolvedValue(due({ myTurn: false }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByText(/Plan the next one when the group's keen/)).toBeVisible();
    expect(screen.queryByText(/your turn/)).toBeNull();
  });

  it('lets the owner snooze it a month, which moves the snooze and nothing else', async () => {
    circleHome.mockResolvedValue(due());
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Snooze a month' }));

    await waitFor(() => expect(updateCircle).toHaveBeenCalledTimes(1));
    const [id, patch] = updateCircle.mock.calls[0] as [string, Record<string, string>];
    expect(id).toBe(CIRCLE);
    expect(Object.keys(patch)).toEqual(['cadenceSnoozedUntil']);
    const days = (Date.parse(patch['cadenceSnoozedUntil'] ?? '') - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    expect(
      await screen.findByText('Snoozed. Nobody will be nudged about Sunday Crew for a month.'),
    ).toBeVisible();
  });

  it('offers a member who is not the owner no snooze, and their own switch', async () => {
    circleHome.mockResolvedValue(due({ isOwner: false, me: 'priya' }));
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Turn off nudges' }));

    expect(screen.queryByRole('button', { name: 'Snooze a month' })).toBeNull();
    await waitFor(() => expect(saveMySwitches).toHaveBeenCalledWith(CIRCLE, { mutedNudges: true }));
    expect(
      await screen.findByText(/You won't be asked to plan the next one in Sunday Crew/),
    ).toBeVisible();
  });

  it('offers no Turn off to somebody whose nudges are already off', async () => {
    circleHome.mockResolvedValue(
      due({ mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: true } }),
    );
    wrap(<CircleHomeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Snooze a month' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn off nudges' })).toBeNull();
  });

  it('says so when a snooze does not save, rather than looking saved', async () => {
    updateCircle.mockRejectedValue(new Error('not saved'));
    circleHome.mockResolvedValue(due());
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Snooze a month' }));

    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
  });

  it('has Plan another as its one action, which is the prefilled plan', async () => {
    circleHome.mockResolvedValue(due());
    wrap(<CircleHomeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Plan another' }));

    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/another',
      params: { id: CIRCLE },
    });
  });
});
