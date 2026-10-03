import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';

/**
 * The confirmed screens after the organiser set their own time, and after they
 * moved it (ADR 0051): what each person sees, and what the organiser pastes.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    dismissTo: vi.fn(),
    canGoBack: () => true,
  }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const planConfirmation = vi.fn();
const setAttendance = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  planConfirmation: (...a: unknown[]) => planConfirmation(...a),
  setAttendance: (...a: unknown[]) => setAttendance(...a),
}));
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const { ConfirmedFlow } = await import('./ConfirmedFlow');
const fixture = await import('./fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  setAttendance.mockResolvedValue(undefined);
});

describe('a time the organiser set themselves', () => {
  it('has the people it covers going and everybody else to confirm, and nobody who cannot', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInOwnTime);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('2 going · 4 to confirm')).toBeTruthy();
    expect(screen.queryByText(/^\d+ can't make it/)).toBeNull();
    // Maya's own times did not cover it: she follows her own answer, with the
    // same two ways to say.
    expect(screen.getByText('Are you coming?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I can make it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "I can't make it" })).toBeTruthy();
  });

  it('says the message the same way as any lock-in: it is not a move', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInOwnTime);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText(/^Locked in: Sunday Crew, /)).toBeTruthy();
    expect(screen.queryByText(/^Moved from /)).toBeNull();
  });
});

describe('after a move', () => {
  it('says the plan moved and from when, on both screens', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInMoved);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText(/^Moved from .*7–9 pm$/)).toBeTruthy();
  });

  it('gives the organiser the paste-ready message for a move, not the lock-in', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInMoved);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    const message = (await screen.findByText(/^Change of plan: Sunday Crew is now /)).textContent;
    expect(message).toMatch(
      /7–9 pm at Hope St Radio\. Details and add-to-calendar: https:\/\/circles\.test\/p\/pnsundaycr$/,
    );
    expect(screen.queryByText(/^Locked in: Sunday Crew/)).toBeNull();
  });

  it('counts who is going again: whoever the new time covers has nothing to do', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInMoved);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('3 going · 3 to confirm')).toBeTruthy();
    expect(screen.getByText("Priya, Sam and Alex haven't said yet")).toBeTruthy();
  });

  it('asks somebody the move left to confirm, and shows the two buttons they already had', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedInMovedAsMember);
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText('The time moved. Are you coming?')).toBeTruthy();
    expect(screen.getByText(/^Moved from /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I can make it' }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-moved', 'priya', 'going'),
    );
    expect(screen.getByRole('button', { name: "I can't make it" })).toBeTruthy();
    // And no organiser controls.
    expect(screen.queryByRole('button', { name: 'Edit this plan' })).toBeNull();
  });

  it('leaves somebody who is going alone: no new question for them', async () => {
    planConfirmation.mockResolvedValue({ ...fixture.lockedInMovedAsMember, me: 'tom' });
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("You're going")).toBeTruthy();
    expect(screen.queryByText('The time moved. Are you coming?')).toBeNull();
  });
});
