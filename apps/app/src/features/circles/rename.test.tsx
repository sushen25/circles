import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tap } from '../../test/tap';
import type * as CircleData from '../../data/circles';
import type * as CircleHomeData from '../../data/circles/home';
import { FunctionError } from '../../data/functions';

/**
 * "Change my name here" in circle settings (SUS-205, ADR 0070): offered on the
 * reader's own row and no other, in the join screen's field and words, and
 * nothing else changes (no analytics, no account name).
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const circleHome = vi.fn();
vi.mock('../../data/circles/home', async (original) => ({
  ...(await original<typeof CircleHomeData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const renameInCircle = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  fetchInviteSecret: () => Promise.resolve(undefined),
  renameInCircle: (...a: unknown[]) => renameInCircle(...a),
}));

const { SettingsFlow } = await import('./SettingsFlow');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';

function home(me: string, isOwner: boolean): CircleData.CircleHome {
  const member = (userId: string, name: string, role: 'owner' | 'member') => ({
    userId,
    name,
    joinedAt: '2026-09-03T00:00:00Z',
    role,
    savedPlace: true,
  });
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
    isOwner,
    me,
    members: [member('maya', 'Maya', 'owner'), member('nina', 'Nina', 'member')],
    activePlan: null,
    lockedIn: null,
    morningAfter: null,
    myTurn: false,
    mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

const refused = (reason: string) =>
  new FunctionError(
    { error: 'conflict', reason, message: 'no', reference: 'ABCD-12' } as never,
    'refused',
  );

beforeEach(() => {
  for (const mock of [circleHome, renameInCircle, track]) mock.mockReset();
  circleHome.mockResolvedValue(home('maya', true));
  renameInCircle.mockResolvedValue(undefined);
});

describe('Change my name here', () => {
  it('is on the reader’s own row only, even for the owner', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Nina')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Change my name here' })).toHaveLength(1);
    // The one button is on Maya's row, not Nina's.
    const mine = screen.getByRole('button', { name: 'Change my name here' }).parentElement;
    expect(mine).toHaveTextContent('Maya');
    expect(mine).not.toHaveTextContent('Nina');
  });

  it('is offered to a member who is not the owner, on their own row', async () => {
    circleHome.mockResolvedValue(home('nina', false));
    wrap(<SettingsFlow id={CIRCLE} />);

    expect(await screen.findByText('Maya')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Change my name here' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('opens the join screen’s field with the current name and saves the tidied name', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);
    await tap(screen.findByRole('button', { name: 'Change my name here' }));

    const sheet = screen.getByLabelText('What should Sunday Crew call you?');
    expect(
      within(sheet).getByText(
        'This is only what Sunday Crew will call you. Your account keeps its own name.',
      ),
    ).toBeVisible();
    const field = within(sheet).getByLabelText('Your name') as HTMLInputElement;
    expect(field.value).toBe('Maya');

    fireEvent.change(field, { target: { value: '  Maya  M ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(renameInCircle).toHaveBeenCalledWith(CIRCLE, 'Maya M', expect.any(String));
    await waitFor(() =>
      expect(screen.queryByLabelText('What should Sunday Crew call you?')).toBeNull(),
    );
    expect(circleHome).toHaveBeenCalledTimes(2);
    // Nothing identifying goes to analytics, and nothing at all for a rename.
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps the sheet open and says so when the name is taken', async () => {
    renameInCircle.mockRejectedValue(refused('duplicate_name'));
    wrap(<SettingsFlow id={CIRCLE} />);
    await tap(screen.findByRole('button', { name: 'Change my name here' }));
    const sheet = screen.getByLabelText('What should Sunday Crew call you?');

    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Nina' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(
      await within(sheet).findByText(/Someone in Sunday Crew is already called Nina/),
    ).toBeVisible();
    // Typing another name clears the refusal, and a different name is a different request.
    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Nina B' } });
    expect(within(sheet).queryByText(/already called/)).toBeNull();
  });

  it('reuses the key for the same name and uses another for a different one', async () => {
    renameInCircle.mockRejectedValue(refused('too_many_requests'));
    wrap(<SettingsFlow id={CIRCLE} />);
    await tap(screen.findByRole('button', { name: 'Change my name here' }));
    const sheet = screen.getByLabelText('What should Sunday Crew call you?');
    const save = async () => {
      const button = await screen.findByRole('button', { name: 'Save' });
      await act(async () => void fireEvent.click(button));
    };

    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Mo' } });
    await save();
    expect(await within(sheet).findByText(/Too many tries/)).toBeVisible();
    await save();
    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Moe' } });
    renameInCircle.mockResolvedValue(undefined);
    await save();

    const keys = renameInCircle.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('does not send a name the join screen would refuse', async () => {
    wrap(<SettingsFlow id={CIRCLE} />);
    await tap(screen.findByRole('button', { name: 'Change my name here' }));
    const sheet = screen.getByLabelText('What should Sunday Crew call you?');

    fireEvent.change(within(sheet).getByLabelText('Your name'), {
      target: { value: 'a'.repeat(41) },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(await within(sheet).findByText(/won't work/)).toBeVisible();
    expect(renameInCircle).not.toHaveBeenCalled();
  });

  it('says the name did not change when something else goes wrong', async () => {
    renameInCircle.mockRejectedValue(new Error('boom'));
    wrap(<SettingsFlow id={CIRCLE} />);
    await tap(screen.findByRole('button', { name: 'Change my name here' }));
    const sheet = screen.getByLabelText('What should Sunday Crew call you?');

    fireEvent.change(within(sheet).getByLabelText('Your name'), { target: { value: 'Mo' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(await within(sheet).findByText(/hasn't changed/)).toBeVisible();
  });
});
