import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as Confirmation from '../../data/confirmation';

/**
 * Circle home's morning-after card (S1-29): the organiser's until answered,
 * a member's once, and nothing on an archived circle.
 */

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const setAttendanceDismissed = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  setAttendanceDismissed: (...a: unknown[]) => setAttendanceDismissed(...a),
}));

const { HomeInState } = await import('./HomeInState');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
const OWED = {
  planId: PLAN,
  code: 'pnsundaycr' as never,
  confirmationId: 'confirmation-1',
  // Thursday 17 September, 6:30 pm in Melbourne.
  startsAt: '2026-09-17T08:30:00.000Z',
  endsAt: '2026-09-17T10:30:00.000Z',
};

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
    members: ['Maya', 'Priya'].map((name, i) => ({
      userId: name.toLowerCase(),
      name,
      joinedAt: `2026-01-0${i + 1}T00:00:00Z`,
      role: i === 0 ? ('owner' as const) : ('member' as const),
    })),
    activePlan: null,
    lockedIn: null,
    morningAfter: null,
    mine: null,
    ...overrides,
  };
}

let client: QueryClient;
function show(data: CircleData.CircleHome) {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HomeInState home={data} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setAttendanceDismissed.mockResolvedValue(undefined);
});

describe('circle home the morning after', () => {
  it('asks the organiser whether it happened, with no way to put it off', () => {
    show(home({ morningAfter: { ...OWED, ask: 'outcome' } }));
    expect(screen.getByText("Did Thursday's catch-up happen?")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/outcome',
      params: { id: CIRCLE, planId: PLAN },
    });
  });

  it('asks a member whether they made it, and remembers "Not now"', async () => {
    show(home({ isOwner: false, me: 'priya', morningAfter: { ...OWED, ask: 'attendance' } }));
    expect(screen.getByText("Did you make it to Thursday's catch-up?")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/p/[code]/attendance',
      params: { code: 'pnsundaycr' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() =>
      expect(setAttendanceDismissed).toHaveBeenCalledWith('priya', 'confirmation-1'),
    );
  });

  it('holds the card whatever state the circle is in — the next plan may be out already', () => {
    show(
      home({
        morningAfter: { ...OWED, ask: 'outcome' },
        activePlan: {
          id: 'next',
          code: 'pnnextxx',
          title: 'Catch up',
          responseDeadline: '2026-09-25T08:00:00Z',
          replied: 1,
          asked: 2,
        },
      }),
    );
    expect(screen.getByText("Did Thursday's catch-up happen?")).toBeTruthy();
  });

  // Review round 1: everybody else left after the meetup, so the home is
  // "just you" — and the organiser still owes the answer.
  it('holds the card when everybody else has left since', () => {
    show(home({ members: home().members.slice(0, 1), morningAfter: { ...OWED, ask: 'outcome' } }));
    expect(screen.getByText("Did Thursday's catch-up happen?")).toBeTruthy();
  });

  it('shows nothing when nothing is owed, or the circle is archived', () => {
    const { unmount } = show(home());
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    unmount();
    show(home({ status: 'archived', morningAfter: { ...OWED, ask: 'outcome' } }));
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
  });
});
