import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';

/**
 * The confirmed screens (S1-28): who gets which, what the organiser shares,
 * what a member can change, and the calendar sheet.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));

const planConfirmation = vi.fn();
const setAttendance = vi.fn();
const calendarFile = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  planConfirmation: (...a: unknown[]) => planConfirmation(...a),
  setAttendance: (...a: unknown[]) => setAttendance(...a),
  calendarFile: (...a: unknown[]) => calendarFile(...a),
}));
const shareMessage = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: vi.fn(),
}));
const saveFile = vi.fn();
vi.mock('../../platform/download', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));

const { ConfirmedFlow } = await import('./ConfirmedFlow');
const fixture = await import('./fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const IDS = { circle_id: 'sunday-crew', plan_id: 'thu-17' };

beforeEach(() => {
  vi.clearAllMocks();
  shareMessage.mockResolvedValue('sheet');
  setAttendance.mockResolvedValue(undefined);
  calendarFile.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  saveFile.mockReturnValue('saved');
});

describe('the organiser', () => {
  beforeEach(() => planConfirmation.mockResolvedValue(fixture.lockedIn));

  it('gets the message to paste, and who has still to say', async () => {
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('Ready to paste into the group chat')).toBeTruthy();
    expect(screen.getByText(/^Locked in: Sunday Crew, .* at Hope St Radio\. /)).toBeTruthy();
    expect(screen.getByText('5 going · 1 to confirm')).toBeTruthy();
    expect(screen.getByText("Alex hasn't said yet")).toBeTruthy();
    expect(screen.queryByText("You're going")).toBeNull();
  });

  it('shares exactly the message on screen, and records that the sheet opened', async () => {
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    const message = (await screen.findByText(/^Locked in: Sunday Crew/)).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Share to group chat' }));
    await waitFor(() => expect(shareMessage).toHaveBeenCalledWith(message));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('share_opened', { ...IDS, kind: 'confirmed' }),
    );
    expect(message).toContain('https://circles.test/p/pnsundaycr');
  });

  it('is the screen the organiser gets on the plan link too', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByRole('button', { name: 'Share to group chat' })).toBeTruthy();
  });
});

describe('a member', () => {
  beforeEach(() => planConfirmation.mockResolvedValue(fixture.lockedInAsMember));

  it('gets their own answer and no organiser controls', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("You're going")).toBeTruthy();
    expect(
      screen.getByText("Maya says: “Table's booked under my name. Come hungry.”"),
    ).toBeTruthy();
    expect(screen.getByText('Open in Maps')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share to group chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change the time' })).toBeNull();
  });

  it("says they can't make it with a write to their own row, and records only which way", async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: "I can't make it after all" }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-1', 'priya', 'cant'),
    );
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('attendance_updated', { ...IDS, status: 'cant' }),
    );
  });

  it('can take it back', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.lockedInAsMember,
      attendance: fixture.lockedIn.attendance.map((a) =>
        a.userId === 'priya' ? { ...a, status: 'cant' as const } : a,
      ),
    });
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("You can't make it")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I can make it' }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-1', 'priya', 'going'),
    );
  });

  it('says so when the change is refused', async () => {
    const { AttendanceError } = await import('../../data/confirmation');
    setAttendance.mockRejectedValue(new AttendanceError('refused'));
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: "I can't make it after all" }));
    expect(await screen.findByText(/can't be changed now/)).toBeTruthy();
    expect(track).not.toHaveBeenCalledWith('attendance_updated', expect.anything());
  });
});

describe('the calendar sheet', () => {
  beforeEach(() => planConfirmation.mockResolvedValue(fixture.lockedInAsMember));

  it('offers the device calendar and not Google, and downloads the file', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    expect(track).toHaveBeenCalledWith('calendar_add_opened', { ...IDS, surface: 'web' });
    expect(
      screen.getByText("Nothing is added to anyone's calendar without their tap."),
    ).toBeTruthy();
    expect(screen.queryByText(/Google/)).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Apple or device calendar. Downloads an .ics file' }),
    );
    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith(
        'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        'sunday-crew-2026-09-17.ics',
        'text/calendar;charset=utf-8',
      ),
    );
    // Fetched once, when the sheet opened, so the tap can hand it over at once.
    expect(calendarFile).toHaveBeenCalledTimes(1);
    expect(calendarFile).toHaveBeenCalledWith('confirmation-1');
    await waitFor(() => expect(track).toHaveBeenCalledWith('ics_downloaded', IDS));
  });

  it('opens on arrival at the calendar link', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} calendar />);
    expect(await screen.findByText('Apple or device calendar')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('calendar_add_opened', { ...IDS, surface: 'web' });
  });
});

describe('a plan that is not locked in', () => {
  it('sends the organiser back to the options when the time was changed', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.lockedIn,
      state: 'collecting',
      confirmation: null,
      attendance: [],
      view: 'open',
    });
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/candidates',
        params: { id: 'sunday-crew', planId: 'thu-17' },
      }),
    );
  });

  it('says a cancelled plan is off', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.lockedIn,
      state: 'cancelled',
      confirmation: null,
      attendance: [],
      view: 'over',
    });
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('This plan is off.')).toBeTruthy();
  });

  it("shows nothing of a plan that is not the reader's", async () => {
    planConfirmation.mockResolvedValue(null);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('This one is not yours to see.')).toBeTruthy();
  });
});
