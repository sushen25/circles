import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleListData from '../../data/circles/list';

/**
 * S3-01a: the app landing — the installed app's first open, signed in. Their
 * circles with the list's own state lines, the notice that links open here
 * now, and no push ask.
 */

const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'app', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return { guard, useSession: () => session, ownDisplayName: () => Promise.resolve('Maya') };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const circlesList = vi.fn();
vi.mock('../../data/circles/list', async (original) => ({
  ...(await original<typeof CircleListData>()),
  circlesList: () => circlesList(),
}));

const { AppLandingFlow } = await import('./AppLandingFlow');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const summary = {
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
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  replace.mockReset();
  circlesList.mockReset();
});

describe('AppLandingFlow', () => {
  it('lists their circles with the state line and says links open here now', async () => {
    circlesList.mockResolvedValue([summary]);
    wrap(<AppLandingFlow />);

    expect(await screen.findByText('Welcome back, Maya.')).toBeVisible();
    expect(screen.getByText('Finding a time · 5 of 6 replied')).toBeVisible();
    expect(
      screen.getByText('Links you tap from the group chat will open here from now on.'),
    ).toBeVisible();
    // No push ask: nothing here offers notifications.
    expect(screen.queryByRole('button', { name: /notif/i })).toBeNull();
  });

  it('opens the first circle by its real id', async () => {
    circlesList.mockResolvedValue([summary]);
    wrap(<AppLandingFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Sunday Crew' }));
    expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } });
  });

  it('says so when the circles cannot be read, and tries again', async () => {
    circlesList.mockRejectedValueOnce(new Error('down')).mockResolvedValue([summary]);
    wrap(<AppLandingFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Welcome back, Maya.')).toBeVisible();
  });
});
