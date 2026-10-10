import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';

/**
 * The confirmed screens (S1-28): who gets which, what the organiser shares,
 * what a member can change, and the calendar sheet.
 */

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const dismissTo = vi.fn();
const focused = { current: true };
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back, dismissTo, canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => focused.current,
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

const home = process.env.TZ;
afterEach(() => {
  if (home === undefined) delete process.env.TZ;
  else process.env.TZ = home;
});

beforeEach(() => {
  vi.clearAllMocks();
  focused.current = true;
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

  it('lets the organiser change their own answer too — they are a member', async () => {
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText("You're going")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "I can't make it after all" }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-1', 'maya', 'cant'),
    );
  });

  it('SUS-169: the plan actions sit with the plan, and the footer keeps share and the calendar', async () => {
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    const edit = await screen.findByRole('button', { name: 'Edit this plan' });
    const ask = screen.getByRole('button', { name: 'Ask for new times' });
    const cancel = screen.getByRole('button', { name: 'Cancel this plan' });
    const paste = screen.getByText('Ready to paste into the group chat');
    const share = screen.getByRole('button', { name: 'Share to group chat' });
    const calendar = screen.getByRole('button', { name: 'Add to my calendar' });
    const decline = screen.getByRole('button', { name: "I can't make it after all" });
    const follows = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    // Edit and Ask sit under the plan's facts; Cancel is last in the body,
    // after the organiser's own answer, and still above the footer.
    for (const action of [edit, ask]) {
      expect(follows(action, paste)).toBe(true);
      expect(follows(action, decline)).toBe(true);
    }
    expect(follows(decline, cancel)).toBe(true);
    expect(follows(paste, cancel)).toBe(true);
    expect(follows(cancel, share)).toBe(true);
    expect(follows(decline, share)).toBe(true);
    expect(follows(share, calendar)).toBe(true);
    expect(
      screen.getAllByRole('button', { name: /Share to group chat|Add to my calendar/ }),
    ).toHaveLength(2);
  });

  it("edits the plan, asks for new times or cancels, by the plan's own circle", async () => {
    // From the plan link too, which has no circle in its route (SUS-42).
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    // Three quiet actions where there were two (ADR 0051): the sibling edit, and
    // "Change the time" renamed for what it does.
    expect(screen.queryByRole('button', { name: 'Change the time' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/edit-locked',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for new times' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/change-time',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this plan' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/cancel',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  // After a lock-in the options sit underneath, and they send a locked-in
  // plan straight back here: "back" would never leave.
  it('goes back to the circle, not to the options that would send it here again', async () => {
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    await screen.findByText('Ready to paste into the group chat');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).not.toHaveBeenCalled();
    expect(dismissTo).toHaveBeenCalledWith({
      pathname: '/circles/[id]',
      params: { id: 'sunday-crew' },
    });
  });

  it("names the circle's zone under the time only when this device is elsewhere", async () => {
    process.env.TZ = 'Europe/London';
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('Times are Melbourne time.')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: 'Edit this plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask for new times' })).toBeNull();
  });

  it('reads the same zone note as the organiser when they are away from home', async () => {
    process.env.TZ = 'Europe/London';
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText('Times are Melbourne time.')).toBeTruthy();
  });

  it("says they can't make it with a write to their own row, and records only which way", async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: "I can't make it after all" }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-1', 'nina', 'cant'),
    );
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('attendance_updated', { ...IDS, status: 'cant' }),
    );
  });

  it('can take it back', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.lockedInAsMember,
      attendance: fixture.lockedIn.attendance.map((a) =>
        a.userId === 'nina' ? { ...a, status: 'cant' as const } : a,
      ),
    });
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("You can't make it")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I can make it' }));
    await waitFor(() =>
      expect(setAttendance).toHaveBeenCalledWith('confirmation-1', 'nina', 'going'),
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

  const DEVICE_ROW = /^Apple or device calendar\. /;
  const row = () => screen.getByRole('button', { name: DEVICE_ROW });
  const readyRow = () =>
    screen.getByRole('button', { name: 'Apple or device calendar. Downloads an event file' });

  it('fetches the file as the confirmed screen loads, so the sheet opens ready', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    const open = await screen.findByRole('button', { name: 'Add to calendar' });
    await waitFor(() => expect(calendarFile).toHaveBeenCalledWith('confirmation-1'));
    await act(async () => undefined);
    fireEvent.click(open);
    expect(readyRow().getAttribute('aria-busy')).toBe('false');
    // Once: opening the sheet does not fetch it again.
    expect(calendarFile).toHaveBeenCalledTimes(1);
  });

  it('offers the device calendar and not Google, and downloads the file', async () => {
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    expect(track).toHaveBeenCalledWith('calendar_add_opened', { ...IDS, surface: 'web' });
    expect(
      screen.getByText("Nothing is added to anyone's calendar without their tap."),
    ).toBeTruthy();
    expect(screen.queryByText(/Google/)).toBeNull();

    await waitFor(() => expect(row().getAttribute('aria-busy')).not.toBe('true'));
    await act(async () => undefined);
    fireEvent.click(readyRow());
    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith(
        'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        'sunday-crew-2026-09-17.ics',
        'text/calendar;charset=utf-8',
      ),
    );
    expect(calendarFile).toHaveBeenCalledTimes(1);
    expect(calendarFile).toHaveBeenCalledWith('confirmation-1');
    await waitFor(() => expect(track).toHaveBeenCalledWith('ics_downloaded', IDS));
    // The next step, named for this device (a desktop browser in the test).
    expect(screen.getByText('Downloaded. Open the file to add it to your calendar.')).toBeTruthy();
  });

  // Mobile Safari only hands a download over from inside the tap, so the row
  // waits for the file and the tap saves it without awaiting anything.
  it('shows a pending row until the file is here, then saves inside the tap', async () => {
    let arrive: (ics: string) => void = () => undefined;
    calendarFile.mockReturnValue(new Promise<string>((resolve) => (arrive = resolve)));
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));

    expect(row().getAttribute('aria-busy')).toBe('true');
    expect(row().getAttribute('aria-label')).toBe('Apple or device calendar. Getting it ready…');
    fireEvent.click(row());
    expect(saveFile).not.toHaveBeenCalled();

    arrive('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    await waitFor(() => expect(row().getAttribute('aria-busy')).not.toBe('true'));
    // react-native-web hands a Pressable its new `onPress` in an effect, so
    // let the commit's effects run before tapping, as any real tap would.
    await act(async () => undefined);
    fireEvent.click(row());
    // Synchronously: no waitFor.
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it('says "Still working on it" when the file takes about eight seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      calendarFile.mockReturnValue(new Promise<string>(() => undefined));
      show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} calendar />);
      expect(await screen.findByText('Getting it ready…')).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_100);
      });
      expect(screen.getByText('Still working on it…')).toBeTruthy();
      expect(row().getAttribute('aria-busy')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers "Try again" inside the row when the fetch fails, and the retry works', async () => {
    calendarFile.mockRejectedValueOnce(new Error('boom'));
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} calendar />);
    expect(await screen.findByText("We couldn't get it.")).toBeTruthy();
    // No separate notice, and no still card: the retry is in the row.
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(calendarFile).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await waitFor(() => expect(calendarFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(row().getAttribute('aria-busy')).toBe('false'));
    expect(screen.queryByText("We couldn't get it.")).toBeNull();
  });

  it.each([
    [
      'an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Saves the event for Calendar',
      'Saved. Open it from Downloads, then tap Add to Calendar.',
    ],
    [
      'Android Chrome',
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Downloads an event file',
      'Saved. Open the file from your notifications or Downloads, then choose Calendar.',
    ],
    [
      'Messenger on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.43.109]',
      'Saves the event for Calendar',
      'Saved. If nothing opened, open this page in your browser and try again.',
    ],
  ])('names what the tap does, and the next step, on %s', async (_name, ua, ready, saved) => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
    try {
      show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} calendar />);
      expect(await screen.findByText(ready)).toBeTruthy();
      await act(async () => undefined);
      fireEvent.click(screen.getByRole('button', { name: `Apple or device calendar. ${ready}` }));
      expect(await screen.findByText(saved)).toBeTruthy();
    } finally {
      agent.mockRestore();
    }
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

  it("stops counting once the meetup is over, when the answers stop being the circle's to read", async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.lockedIn,
      state: 'completed',
      view: 'past',
    });
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    expect(await screen.findByText('This meetup’s time has passed.')).toBeTruthy();
    expect(screen.queryByText(/going/)).toBeNull();
  });

  it('trusts no cached state when the refetch fails: it says so instead', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['plan-confirmation', 'thu-17', 'maya'], {
      ...fixture.lockedIn,
      state: 'collecting',
      confirmation: null,
      attendance: [],
      view: 'open',
    });
    planConfirmation.mockRejectedValue(new Error('confirmation lookup failed'));
    render(
      <QueryClientProvider client={client}>
        <ConfirmedFlow target={{ planId: 'thu-17' }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("We couldn't load this plan.")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends nobody anywhere while it is not the screen on top', async () => {
    focused.current = false;
    planConfirmation.mockResolvedValue({
      ...fixture.lockedIn,
      state: 'collecting',
      confirmation: null,
      attendance: [],
      view: 'open',
    });
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    await waitFor(() => expect(planConfirmation).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();
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
