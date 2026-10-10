import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CircleHome } from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';

/**
 * SUS-198: the plan card's marks say who has not answered, with the dashed
 * outline (manifesto §5.4) and in what a screen reader hears; the members row
 * below it says only who is in.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
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
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));
const circleHome = vi.fn();
vi.mock('../../data/circles/home', async (original) => ({
  ...(await original<typeof CircleHomeData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));

const { CircleHomeFlow } = await import('./CircleHomeFlow');

const NAMES = ['Maya', 'Nina', 'Tom', 'Jess', 'Sam', 'Alex'];

function home(answers: unknown): CircleHome {
  return {
    id: '00000000-0000-4000-8000-00000000c1c1',
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
    members: NAMES.map((name, i) => ({
      userId: name.toLowerCase(),
      name,
      joinedAt: `2026-01-0${i + 1}T00:00:00Z`,
      role: i === 0 ? ('owner' as const) : ('member' as const),
      savedPlace: true,
    })),
    activePlan: {
      id: '00000000-0000-4000-8000-00000000b1a1',
      code: 'pnsundaycr',
      organiserUserId: 'maya',
      title: 'Catch up',
      responseDeadline: '2026-09-29T08:00:00Z',
      replied: 5,
      asked: 6,
      answers: answers as never,
    },
    lockedIn: null,
    morningAfter: null,
    myTurn: false,
    mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
  };
}

const answered = (except: string[]) =>
  NAMES.map((n) => ({ userId: n.toLowerCase(), replied: !except.includes(n) }));

function wrap() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CircleHomeFlow id="c" />
    </QueryClientProvider>,
  );
}

const dashed = (mark: Element) => getComputedStyle(mark).borderStyle === 'dashed';

beforeEach(() => circleHome.mockReset());

describe('circle home, the plan card and the members row (SUS-198)', () => {
  it('draws a non-responder dashed and says who has not answered', async () => {
    circleHome.mockResolvedValue(home(answered(['Alex'])));
    wrap();

    const card = await screen.findByRole('img', {
      name: "Maya, Nina, Tom, Jess and Sam answered; Alex hasn't yet",
    });
    const marks = Array.from(card.children);
    expect(marks.map((m) => m.textContent)).toEqual(['M', 'N', 'T', 'J', 'S', 'A']);
    expect(marks.map(dashed)).toEqual([false, false, false, false, false, true]);
  });

  it('keeps the members row plain, with a label that does not say "answered"', async () => {
    circleHome.mockResolvedValue(home(answered(['Alex'])));
    wrap();

    const row = await screen.findByRole('img', {
      name: 'Maya, Nina, Tom, Jess, Sam and Alex',
    });
    expect(Array.from(row.children).some(dashed)).toBe(false);
    expect(screen.getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual([
      "Maya, Nina, Tom, Jess and Sam answered; Alex hasn't yet",
      'Maya, Nina, Tom, Jess, Sam and Alex',
    ]);
  });

  it('names several who have not answered with "haven\'t"', async () => {
    circleHome.mockResolvedValue(home(answered(['Tom', 'Alex'])));
    wrap();
    expect(
      await screen.findByRole('img', {
        name: "Maya, Nina, Jess and Sam answered; Tom and Alex haven't yet",
      }),
    ).toBeVisible();
  });

  it('does not say "answered" when nobody has', async () => {
    circleHome.mockResolvedValue(home(answered(NAMES)));
    wrap();
    expect(
      await screen.findByRole('img', {
        name: "Maya, Nina, Tom, Jess, Sam and Alex haven't answered yet",
      }),
    ).toBeVisible();
  });

  it('draws plain marks and claims nothing when the reader may not see reply state', async () => {
    // A member before options exist (spec §5.6): the view returns nothing.
    circleHome.mockResolvedValue(home(undefined));
    wrap();

    await screen.findByText('5 of 6 replied');
    const labels = screen.getAllByRole('img').map((e) => e.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Maya, Nina, Tom, Jess, Sam and Alex',
      'Maya, Nina, Tom, Jess, Sam and Alex',
    ]);
    expect(
      screen
        .getAllByRole('img')
        .flatMap((e) => Array.from(e.children))
        .some(dashed),
    ).toBe(false);
  });

  it('marks only the people the plan asked', async () => {
    // Alex joined after the plan was made: not asked, so not drawn on its card.
    circleHome.mockResolvedValue(home(answered([]).filter((a) => a.userId !== 'alex')));
    wrap();
    expect(
      await screen.findByRole('img', { name: 'Maya, Nina, Tom, Jess and Sam answered' }),
    ).toBeVisible();
  });
});
