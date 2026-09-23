import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';

/**
 * Notification settings (S1-23): three switches per circle, each the reader's
 * own membership row, and quiet hours that say they are fixed.
 */

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session: {
  status: string;
  userId: string | undefined;
  isAnonymous: boolean;
  isLoading: boolean;
} = {
  status: 'saved',
  userId: 'maya',
  isAnonymous: false,
  isLoading: false,
};
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const mySwitchesEverywhere = vi.fn();
const saveMySwitches = vi.fn();
const myOrganiserEmailMuted = vi.fn();
const saveOrganiserEmailMuted = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  mySwitchesEverywhere: () => mySwitchesEverywhere(),
  saveMySwitches: (...a: unknown[]) => saveMySwitches(...a),
  myOrganiserEmailMuted: () => myOrganiserEmailMuted(),
  saveOrganiserEmailMuted: (...a: unknown[]) => saveOrganiserEmailMuted(...a),
}));

const { NotificationSettingsFlow } = await import('./NotificationSettingsFlow');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  session.status = 'saved';
  session.userId = 'maya';
  replace.mockReset();
  mySwitchesEverywhere.mockReset();
  saveMySwitches.mockReset();
  myOrganiserEmailMuted.mockReset();
  saveOrganiserEmailMuted.mockReset();
  myOrganiserEmailMuted.mockResolvedValue(false);
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

  describe('emails about plans you organise (ADR 00XX)', () => {
    const name = 'Emails about plans you organise';

    it('is one switch for the person, above the circles, and says which email still comes', async () => {
      wrap(<NotificationSettingsFlow />);

      expect(await screen.findByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getAllByRole('switch', { name })).toHaveLength(1);
      // The detail line is what keeps the switch from lying about replies closed.
      expect(screen.getByText(/we'll still email you once/)).toBeVisible();
    });

    it('shows it off when the profile has it off', async () => {
      myOrganiserEmailMuted.mockResolvedValue(true);
      wrap(<NotificationSettingsFlow />);

      expect(await screen.findByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
    });

    it('saves turning it off to the reader’s own profile', async () => {
      saveOrganiserEmailMuted.mockResolvedValue(undefined);
      wrap(<NotificationSettingsFlow />);

      const toggle = await screen.findByRole('switch', { name });
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(saveOrganiserEmailMuted).toHaveBeenCalledWith(true);
      expect(saveMySwitches).not.toHaveBeenCalled();
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('puts it back when the save fails, and says so', async () => {
      saveOrganiserEmailMuted.mockRejectedValue(new Error('circle setting not saved'));
      wrap(<NotificationSettingsFlow />);

      const toggle = await screen.findByRole('switch', { name });
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    });

    it('sends a signed-out reader through sign-in and back here, where the email pointed', async () => {
      // The organiser emails link to this screen with no token (ADR 00XX). On
      // a browser that is not signed in, the reader has an account: sign-in,
      // then the switch — not Welcome, and not their circles list.
      session.status = 'none';
      session.userId = undefined;
      wrap(<NotificationSettingsFlow />);

      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith({
          pathname: '/sign-in',
          params: { next: '/settings/notifications' },
        }),
      );
      expect(myOrganiserEmailMuted).not.toHaveBeenCalled();
    });

    it('does not show the page until it knows, and says so when it cannot', async () => {
      myOrganiserEmailMuted.mockRejectedValue(new Error('organiser email setting lookup failed'));
      wrap(<NotificationSettingsFlow />);

      expect(await screen.findByText("We couldn't load your settings.")).toBeVisible();
      expect(screen.queryByRole('switch', { name })).toBeNull();
    });
  });
});
