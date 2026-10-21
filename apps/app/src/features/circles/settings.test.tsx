import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';

/**
 * Circle settings (S1-23): the owner's link shown, copied and reset; the
 * rhythm and the nudge; a member removed; the circle archived — and a member
 * who is not the owner offered none of it.
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
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const copyText = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: vi.fn(),
  copyText: (...a: unknown[]) => copyText(...a),
}));

const circleHome = vi.fn();
vi.mock('../../data/circles/home', async (original) => ({
  ...(await original<typeof CircleHomeData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const fetchInviteSecret = vi.fn();
const resetInviteLink = vi.fn();
const removeMember = vi.fn();
const leaveCircle = vi.fn();
const updateCircle = vi.fn();
const saveMySwitches = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  fetchInviteSecret: (...a: unknown[]) => fetchInviteSecret(...a),
  resetInviteLink: (...a: unknown[]) => resetInviteLink(...a),
  removeMember: (...a: unknown[]) => removeMember(...a),
  leaveCircle: (...a: unknown[]) => leaveCircle(...a),
  updateCircle: (...a: unknown[]) => updateCircle(...a),
  saveMySwitches: (...a: unknown[]) => saveMySwitches(...a),
}));

const { SettingsFlow } = await import('./SettingsFlow');
const { InviteCircleFlow } = await import('./InviteCircleFlow');
const { keepInviteSecret } = await import('../../data/circles');
const { forgetInviteSecretsForTests } = await import('../../data/circles/invite');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const secret = () =>
  (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');

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
    lastMetAt: null,
    cadenceSnoozedUntil: null,
    defaultDurationMinutes: 120,
    defaultQuorum: null,
    isOwner: true,
    me: 'maya',
    members: [
      {
        userId: 'maya',
        name: 'Maya',
        joinedAt: '2026-09-01T00:00:00Z',
        role: 'owner',
        savedPlace: true,
      },
      {
        userId: 'nina',
        name: 'Nina',
        joinedAt: '2026-09-03T00:00:00Z',
        role: 'member',
        savedPlace: true,
      },
      {
        userId: 'tom',
        name: 'Tom',
        joinedAt: '2026-09-04T00:00:00Z',
        role: 'member',
        savedPlace: false,
      },
      {
        userId: 'jess',
        name: 'Jess',
        joinedAt: '2026-09-04T00:00:00Z',
        role: 'member',
        savedPlace: true,
      },
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
  forgetInviteSecretsForTests();
  for (const mock of [
    push,
    replace,
    track,
    copyText,
    circleHome,
    fetchInviteSecret,
    resetInviteLink,
    removeMember,
    updateCircle,
    saveMySwitches,
  ]) {
    mock.mockReset();
  }
  circleHome.mockResolvedValue(home());
  updateCircle.mockResolvedValue(undefined);
  saveMySwitches.mockResolvedValue(undefined);
});

describe('a circle at the member cap (SUS-199)', () => {
  const twenty = () =>
    Array.from({ length: 20 }, (_, i) => ({
      userId: i === 0 ? 'maya' : `m${i}`,
      name: i === 0 ? 'Maya' : i === 1 ? 'Nina' : `Guest ${i}`,
      joinedAt: '2026-09-03T00:00:00Z',
      role: i === 0 ? ('owner' as const) : ('member' as const),
      savedPlace: true,
    }));

  it('says it is full in place of the link, and never asks for the link', async () => {
    circleHome.mockResolvedValue(home({ name: 'Thursday Lot', members: twenty() }));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    expect(screen.getByText(/The invite link comes back once there is room/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset link' })).toBeNull();
    expect(fetchInviteSecret).not.toHaveBeenCalled();
    // The way to make room is still here.
    expect(screen.getByRole('button', { name: 'Remove Guest 2' })).toBeVisible();
  });

  it('tells a member who is not the owner it is full, without the owner’s hint', async () => {
    circleHome.mockResolvedValue(
      home({ name: 'Thursday Lot', members: twenty(), isOwner: false, me: 'nina' }),
    );
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    expect(screen.queryByText(/invite link comes back/)).toBeNull();
  });

  it('says so on the invite screen too, with settings as the way on', async () => {
    circleHome.mockResolvedValue(home({ name: 'Thursday Lot', members: twenty() }));
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    expect(fetchInviteSecret).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Circle settings' }));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
  });

  it('still shows the link at nineteen', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    circleHome.mockResolvedValue(home({ members: twenty().slice(0, 19) }));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Reset link' })).toBeVisible();
    expect(screen.queryByText(/is full/)).toBeNull();
  });
});

describe('the invite link in settings', () => {
  it('asks for the owner’s link, shows only its end, and copies the whole of it', async () => {
    const shown = secret();
    fetchInviteSecret.mockImplementation((id: string) => {
      keepInviteSecret(id, shown);
      return Promise.resolve(shown);
    });
    copyText.mockResolvedValue(true);
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText(new RegExp(`/join#…${shown.slice(-4)}$`))).toBeVisible();
    expect(screen.queryByText(new RegExp(shown))).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(copyText).toHaveBeenCalledWith(`https://circles.test/join#${shown}`);
    expect(JSON.stringify(track.mock.calls)).not.toContain(shown);
  });

  it('resets it after asking, and says the old one has stopped working', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    const fresh = secret();
    resetInviteLink.mockImplementation((id: string) => {
      keepInviteSecret(id, fresh);
      return Promise.resolve(fresh);
    });
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText(/can't be shown again/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    const sheet = screen.getByLabelText('Reset the invite link?');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Reset link' }));
    });

    expect(resetInviteLink).toHaveBeenCalledWith(CIRCLE, expect.any(String));
    expect(await screen.findByText('New link ready. The old one no longer works.')).toBeVisible();
    expect(screen.getByText(new RegExp(`/join#…${fresh.slice(-4)}$`))).toBeVisible();
  });

  it('keeps a reset that worked as worked, even when the refresh after it fails', async () => {
    // Round 1: the key used to be dropped before a fallible refetch, so a
    // "failed" reset retried under a fresh key and killed the link it made.
    fetchInviteSecret.mockResolvedValueOnce(undefined);
    fetchInviteSecret.mockRejectedValue(new Error('get-invite-link failed'));
    resetInviteLink.mockImplementation((id: string) => {
      const fresh = secret();
      keepInviteSecret(id, fresh);
      return Promise.resolve(fresh);
    });
    wrap(<SettingsFlow id={CIRCLE} />);

    const reset = async () => {
      await tap(screen.findByRole('button', { name: 'Reset link' }));
      await act(async () => {
        fireEvent.click(
          within(screen.getByLabelText('Reset the invite link?')).getByRole('button', {
            name: 'Reset link',
          }),
        );
      });
    };
    await reset();
    expect(await screen.findByText('New link ready. The old one no longer works.')).toBeVisible();
    expect(screen.queryByText("The link didn't reset. Try again.")).toBeNull();

    // A second, deliberate reset is a new request with a key of its own.
    await reset();
    const [first, second] = resetInviteLink.mock.calls.map((call) => call[1] as string);
    expect(first).not.toBe(second);
  });
});

describe('when the link cannot be asked for', () => {
  it('says so and offers to try again, rather than calling the link lost', async () => {
    fetchInviteSecret.mockRejectedValueOnce(new Error('get-invite-link failed'));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText("We couldn't get the link just now.")).toBeVisible();
    expect(screen.queryByText(/can't be shown again/)).toBeNull();

    const shown = secret();
    fetchInviteSecret.mockImplementation((id: string) => {
      keepInviteSecret(id, shown);
      return Promise.resolve(shown);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText(new RegExp(`/join#…${shown.slice(-4)}$`))).toBeVisible();
  });
});

describe('the owner’s other settings', () => {
  it('changes the rhythm from the picker', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'About fortnightly' }));
    });
    expect(updateCircle).toHaveBeenCalledWith(CIRCLE, { cadence: 'fortnightly' });
  });

  it('shows who would be nudged when nobody has chosen: take turns from four', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);
    expect(await screen.findByText('Take turns')).toBeVisible();
  });

  it('removes a member after asking, by their id', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    removeMember.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Remove Tom' }));
    const sheet = screen.getByLabelText('Remove Tom?');
    expect(within(sheet).getByText(/Their times for plans still asking are deleted/)).toBeVisible();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Tom' }));
    });
    expect(removeMember).toHaveBeenCalledWith(CIRCLE, 'tom', expect.any(String));
  });

  it('never offers the owner Leave, and says why', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);
    expect(
      await screen.findByText(
        /You own this circle, so you can't leave it.*the saved-place member who has been in it longest/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Leave this circle' })).toBeNull();
  });

  it('never offers to remove the owner', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);
    await screen.findByText('You · owner');
    expect(screen.queryByRole('button', { name: 'Remove Maya' })).toBeNull();
  });

  it('archives after asking', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Archive this circle' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText('Archive Sunday Crew?')).getByRole('button', {
          name: 'Archive',
        }),
      );
    });
    expect(updateCircle).toHaveBeenCalledWith(CIRCLE, { status: 'archived' });
  });
});

describe('who is a guest and who has saved their place (SUS-165)', () => {
  it('says the tier on every row, to the owner', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('You · owner')).toBeVisible();
    expect(screen.getByText(/^Place saved · joined .*\b3\b/)).toBeVisible();
    expect(screen.getByText(/^Guest · joined .*\b4\b/)).toBeVisible();
  });

  it('says only "You · guest" on a guest’s own row, and when the rest joined (ADR 0060)', async () => {
    // The data carries a saved-place state for the reader alone.
    const base = home({ isOwner: false, me: 'tom' });
    circleHome.mockResolvedValue({
      ...base,
      members: base.members.map((m) => (m.userId === 'tom' ? m : { ...m, savedPlace: null })),
    });
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('You · guest')).toBeVisible();
    expect(screen.getByText('Owner')).toBeVisible();
    expect(screen.getAllByText(/^Joined .*\b[34]\b/)).toHaveLength(2);
    expect(screen.queryByText(/^Place saved/)).toBeNull();
    expect(screen.queryByText(/^Guest ·/)).toBeNull();
  });
});

describe('a member who is not the owner', () => {
  beforeEach(() => {
    circleHome.mockResolvedValue(home({ isOwner: false, me: 'nina' }));
  });

  it('sees the settings, changes none of the owner’s, and is never shown the link', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Only Maya can change these.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset link' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive this circle' })).toBeNull();
    expect(fetchInviteSecret).not.toHaveBeenCalled();
  });

  it('leaves after asking, and goes back to the list of circles', async () => {
    leaveCircle.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Leave this circle' }));
    const sheet = screen.getByLabelText('Leave Sunday Crew?');
    expect(within(sheet).getByText(/your answers to plans still asking are deleted/)).toBeVisible();
    expect(leaveCircle).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Leave Sunday Crew' }));
    });
    expect(leaveCircle).toHaveBeenCalledWith(CIRCLE, expect.any(String));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
  });

  it('turns quiet asks off for themselves', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    await act(async () => {
      await tap(screen.findByRole('switch', { name: 'Quiet asks' }));
    });
    await waitFor(() =>
      expect(saveMySwitches).toHaveBeenCalledWith(CIRCLE, { mutedQuietAsks: true }),
    );
  });
});

describe('a choice the server nearly always accepts', () => {
  it('shows the quiet-asks switch at once, before the server has answered', async () => {
    let answer: () => void = () => undefined;
    saveMySwitches.mockReturnValue(new Promise<void>((resolve) => (answer = resolve)));
    wrap(<SettingsFlow id={CIRCLE} />);

    const toggle = await screen.findByRole('switch', { name: 'Quiet asks' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(toggle);
    });
    // The cache tells its observers in a `setTimeout(0)` of its own, which
    // `act` does not wait for: on a busy machine the assertion ran first.
    // Waiting for it is still "before the server has answered" - `answer` is
    // called below, after.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Quiet asks' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    answer();
  });

  it('puts the switch back, and says so, when the server refuses', async () => {
    saveMySwitches.mockRejectedValue(new Error('no'));
    wrap(<SettingsFlow id={CIRCLE} />);

    await act(async () => {
      await tap(screen.findByRole('switch', { name: 'Quiet asks' }));
    });
    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Quiet asks' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('puts the rhythm back, and says so, when the server refuses', async () => {
    updateCircle.mockRejectedValue(new Error('no'));
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<SettingsFlow id={CIRCLE} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'About fortnightly' }));
    });
    expect(await screen.findByText("That didn't save. Try again.")).toBeVisible();
    expect(updateCircle).toHaveBeenCalledWith(CIRCLE, { cadence: 'fortnightly' });
  });
});
