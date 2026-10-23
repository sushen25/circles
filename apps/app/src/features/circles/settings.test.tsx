import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { tap } from '../../test/tap';
import { brand } from '@circles/config';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';

/**
 * Circle settings (S1-23, SUS-248): who is in, Add someone for any member and
 * Cancel old invitations for the owner alone; the rhythm and the nudge; a
 * member removed; the circle archived — and the Add someone screen, which any
 * active member can open (ADR 0091).
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
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
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
    shareMessage,
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

  it('says it is full in place of Add someone, and never asks for the invitation', async () => {
    circleHome.mockResolvedValue(home({ name: 'Thursday Lot', members: twenty() }));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Thursday Lot is full (20 people)')).toBeVisible();
    expect(screen.getByText(/Adding someone comes back once there is room/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add someone' })).toBeNull();
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
    expect(screen.queryByText(/Adding someone comes back/)).toBeNull();
  });

  it('says so on the Add someone screen too, with settings as the way on', async () => {
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

  it('still offers Add someone at nineteen', async () => {
    circleHome.mockResolvedValue(home({ members: twenty().slice(0, 19) }));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Add someone' })).toBeVisible();
    expect(screen.queryByText(/is full/)).toBeNull();
  });
});

describe("who's in, and Add someone, in settings (SUS-248)", () => {
  it('opens with the members, then Add someone, and shows no link or reset beside them', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    const heading = await screen.findByRole('heading', { name: "Who's in" });
    const add = screen.getByRole('button', { name: 'Add someone' });
    const cancel = screen.getByRole('button', { name: 'Cancel old invitations' });
    const catchUp = screen.getByText('Catch up');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, screen.getByText('Nina'))).toBe(true);
    expect(follows(screen.getByText('Jess'), add)).toBe(true);
    expect(follows(add, cancel)).toBe(true);
    expect(follows(cancel, catchUp)).toBe(true);
    expect(screen.getByText("If one has gone somewhere it shouldn't.")).toBeVisible();
    expect(screen.queryByRole('button', { name: /link/i })).toBeNull();
    // Settings no longer asks for the secret: it is not drawn here.
    expect(fetchInviteSecret).not.toHaveBeenCalled();
  });

  it('goes to Add someone', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Add someone' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/circles/[id]/invite', params: { id: CIRCLE } });
  });

  it('cancels old invitations after asking, and says plans already shared keep working', async () => {
    const fresh = secret();
    resetInviteLink.mockImplementation((id: string) => {
      keepInviteSecret(id, fresh);
      return Promise.resolve(fresh);
    });
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Cancel old invitations' }));
    const sheet = screen.getByLabelText('Cancel old invitations?');
    expect(
      within(sheet).getByText(
        "Add someone messages already sent stop working. Plans you've shared keep working, and everyone in Sunday Crew stays in.",
      ),
    ).toBeVisible();
    expect(resetInviteLink).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel them' }));
    });

    expect(resetInviteLink).toHaveBeenCalledWith(CIRCLE, expect.any(String));
    expect(
      await screen.findByText('Old invitations cancelled. Add someone makes a new one.'),
    ).toBeVisible();
  });

  it('keeps them when asked to', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Cancel old invitations' }));
    const sheet = screen.getByLabelText('Cancel old invitations?');
    await act(async () => {
      fireEvent.click(within(sheet).getAllByRole('button', { name: 'Keep them' }).at(-1)!);
    });
    expect(resetInviteLink).not.toHaveBeenCalled();
  });

  it('says so, and cancels nothing it did not, when the server refuses', async () => {
    resetInviteLink.mockRejectedValue(new Error('rotate-invite failed'));
    wrap(<SettingsFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Cancel old invitations' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText('Cancel old invitations?')).getByRole('button', {
          name: 'Cancel them',
        }),
      );
    });
    expect(await screen.findByText("The invitations weren't cancelled. Try again.")).toBeVisible();
    expect(
      screen.queryByText('Old invitations cancelled. Add someone makes a new one.'),
    ).toBeNull();
  });

  it('keeps a cancel that worked as worked: a second one is a request of its own', async () => {
    // Round 1: the key used to be dropped before a fallible refetch, so a
    // "failed" reset retried under a fresh key and killed the link it made.
    resetInviteLink.mockImplementation((id: string) => {
      const fresh = secret();
      keepInviteSecret(id, fresh);
      return Promise.resolve(fresh);
    });
    wrap(<SettingsFlow id={CIRCLE} />);

    const cancel = async () => {
      await tap(screen.findByRole('button', { name: 'Cancel old invitations' }));
      await act(async () => {
        fireEvent.click(
          within(screen.getByLabelText('Cancel old invitations?')).getByRole('button', {
            name: 'Cancel them',
          }),
        );
      });
    };
    await cancel();
    expect(
      await screen.findByText('Old invitations cancelled. Add someone makes a new one.'),
    ).toBeVisible();
    await cancel();
    const [first, second] = resetInviteLink.mock.calls.map((call) => call[1] as string);
    expect(first).not.toBe(second);
  });
});

describe('Add someone, for any active member (SUS-248, ADR 0091)', () => {
  const message = (link: string) =>
    `Join Sunday Crew on ${brand.name} so you're in on the next catch-up. No app needed: ${link}`;

  it.each([
    ['the owner', true, 'maya'],
    ['a member who is not the owner', false, 'nina'],
  ])(
    'asks for the invitation again after a reload, and shows it to %s',
    async (_who, isOwner, me) => {
      circleHome.mockResolvedValue(home({ isOwner, me }));
      const shown = secret();
      fetchInviteSecret.mockImplementation((id: string) => {
        keepInviteSecret(id, shown);
        return Promise.resolve(shown);
      });
      wrap(<InviteCircleFlow id={CIRCLE} />);

      expect(
        await screen.findByRole('heading', { name: 'Add someone to Sunday Crew' }),
      ).toBeVisible();
      expect(fetchInviteSecret).toHaveBeenCalledWith(CIRCLE);
      expect(screen.getByText('Their invitation')).toBeVisible();
      expect(screen.getByText(`https://circles.test/join#${shown}`)).toBeVisible();
      expect(
        screen.getByText("They're in as soon as they add a name. No app, no account."),
      ).toBeVisible();
      // Nothing about resets, and no button is named for a link.
      expect(screen.queryByText(/reset/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /link/i })).toBeNull();
    },
  );

  it('shares the invitation, and counts the share without what it said', async () => {
    const shown = secret();
    keepInviteSecret(CIRCLE, shown);
    shareMessage.mockResolvedValue('sheet');
    wrap(<InviteCircleFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Share' }));
    expect(shareMessage).toHaveBeenCalledWith(message(`https://circles.test/join#${shown}`));
    expect(track).toHaveBeenCalledWith('share_opened', { circle_id: CIRCLE, kind: 'invite' });
    expect(JSON.stringify(track.mock.calls)).not.toContain(shown);
    expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } });
  });

  it('copies the invitation and says so, and stays so it can be pasted and come back', async () => {
    const shown = secret();
    keepInviteSecret(CIRCLE, shown);
    copyText.mockResolvedValue(true);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Copy' }));
    expect(copyText).toHaveBeenCalledWith(message(`https://circles.test/join#${shown}`));
    expect(await screen.findByText('Copied. Paste it into your chat.')).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says when it could not copy', async () => {
    keepInviteSecret(CIRCLE, secret());
    copyText.mockResolvedValue(false);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    await tap(screen.findByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/We couldn't copy it here/)).toBeVisible();
  });

  it('says so and offers to try again when it cannot be asked for', async () => {
    fetchInviteSecret.mockRejectedValueOnce(new Error('get-invite-link failed'));
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText("We couldn't load this circle.")).toBeVisible();
    const shown = secret();
    fetchInviteSecret.mockImplementation((id: string) => {
      keepInviteSecret(id, shown);
      return Promise.resolve(shown);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByRole('button', { name: 'Share' })).toBeVisible();
  });

  it('tells the owner the invitation cannot be shown again, and where to cancel old ones', async () => {
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText('Sunday Crew needs a new invitation.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open circle settings' }));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/settings',
      params: { id: CIRCLE },
    });
  });

  it('tells a member the same, and to ask the owner, with no settings to open', async () => {
    circleHome.mockResolvedValue(home({ isOwner: false, me: 'nina' }));
    fetchInviteSecret.mockResolvedValue(undefined);
    wrap(<InviteCircleFlow id={CIRCLE} />);

    expect(await screen.findByText('Sunday Crew needs a new invitation.')).toBeVisible();
    expect(screen.getByText(/Ask the owner to cancel old invitations/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open circle settings' })).toBeNull();
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

  it('sees the settings and Add someone, and changes none of the owner’s, nor cancels invitations', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Only Maya can change these.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add someone' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel old invitations' })).toBeNull();
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
