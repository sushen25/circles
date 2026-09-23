import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';

/**
 * Notification settings (S1-23): three switches per circle, each the reader's
 * own membership row, and quiet hours that say they are fixed.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const mySwitchesEverywhere = vi.fn();
const saveMySwitches = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  mySwitchesEverywhere: () => mySwitchesEverywhere(),
  saveMySwitches: (...a: unknown[]) => saveMySwitches(...a),
}));

const { NotificationSettingsFlow } = await import('./NotificationSettingsFlow');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  mySwitchesEverywhere.mockReset();
  saveMySwitches.mockReset();
  mySwitchesEverywhere.mockResolvedValue([
    {
      circleId: 'c1',
      circleName: 'Sunday Crew',
      mutedAll: false,
      mutedQuietAsks: true,
      mutedNudges: false,
    },
  ]);
});

describe('notification settings', () => {
  it('shows each switch as the membership row has it', async () => {
    wrap(<NotificationSettingsFlow />);

    expect(
      await screen.findByRole('switch', { name: 'Everything from Sunday Crew' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Quiet asks in Sunday Crew' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('saves a nudge switch to the reader’s own row', async () => {
    saveMySwitches.mockResolvedValue(undefined);
    wrap(<NotificationSettingsFlow />);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole('switch', { name: 'Nudges to plan the next one in Sunday Crew' }),
      );
    });
    expect(saveMySwitches).toHaveBeenCalledWith('c1', { mutedNudges: true });
  });

  it('puts a switch back when the save fails, and says so', async () => {
    saveMySwitches.mockRejectedValue(new Error('circle setting not saved'));
    wrap(<NotificationSettingsFlow />);

    const all = await screen.findByRole('switch', { name: 'Everything from Sunday Crew' });
    await act(async () => {
      fireEvent.click(all);
    });
    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
    await waitFor(() => expect(all).toHaveAttribute('aria-checked', 'true'));
  });

  it('says quiet hours are fixed rather than pretending to change them', async () => {
    wrap(<NotificationSettingsFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    expect(screen.getByText(/9 pm and 8 am in your own time zone/)).toBeVisible();
  });
});
