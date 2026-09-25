import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';
import { FunctionError } from '../../data/functions';

/**
 * The morning after (S1-29): who gets which question, what each answer sends
 * and records, where it goes next, and the confirmed screen's way in.
 */

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const dismissTo = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back, dismissTo, canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));

const planConfirmation = vi.fn();
const reportOutcome = vi.fn();
const reportAttendance = vi.fn();
const setAttendanceDismissed = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  planConfirmation: (...a: unknown[]) => planConfirmation(...a),
  reportOutcome: (...a: unknown[]) => reportOutcome(...a),
  reportAttendance: (...a: unknown[]) => reportAttendance(...a),
  setAttendanceDismissed: (...a: unknown[]) => setAttendanceDismissed(...a),
}));

// `record-nudge`: no by default, so every answer below ends on "Thanks, noted.";
// the after-attendance cases say yes.
const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
  ownNudgeHistory: async () => [],
}));

const { MorningAfterFlow } = await import('./MorningAfterFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const { ConfirmedFlow } = await import('./ConfirmedFlow');
const fixture = await import('./fixtures');

let client: QueryClient;
function show(node: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const IDS = { circle_id: 'sunday-crew', plan_id: 'thu-17' };
const TO_CIRCLE = { pathname: '/circles/[id]', params: { id: 'sunday-crew' } };
const EVIDENCE = { corroboration: 'reported', was_there: 2, missed: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  forgetSessionNudges();
  askToShow.mockResolvedValue({ suppressed: true, reason: 'not_the_moment' });
  recordAnswer.mockResolvedValue(undefined);
  reportOutcome.mockResolvedValue(EVIDENCE);
  reportAttendance.mockResolvedValue(EVIDENCE);
  setAttendanceDismissed.mockResolvedValue(undefined);
});

describe('the organiser', () => {
  beforeEach(() => planConfirmation.mockResolvedValue(fixture.morningAfter));

  it('is asked with nothing chosen for them, and cannot save nothing', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("Did Thursday's catch-up happen?")).toBeTruthy();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('asks "did the plan change outside the app?" as its own tap, and waits for it', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'It happened' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Did the plan change outside the app?')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Yes' }));
    expect(save.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(save);
    // "It happened" and "yes, it changed outside": the survey is not read off
    // the outcome (review round 2).
    await waitFor(() =>
      expect(reportOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'happened', movedOutside: true }),
      ),
    );
  });

  it('fills in the obvious yes for "we moved it outside", and lets it be changed', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: /^We moved it outside/ }));
    expect(screen.getByRole('checkbox', { name: 'Yes' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(reportOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'moved_outside', movedOutside: false }),
      ),
    );
  });

  it('reports the answer with its note, records it, and goes to the circle', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'It happened' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.change(screen.getByLabelText("A line for the circle's record, optional"), {
      target: { value: 'Great night' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(TO_CIRCLE));
    expect(reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'confirmation-1',
        outcome: 'happened',
        movedOutside: false,
        note: 'Great night',
      }),
    );
    expect(track).toHaveBeenCalledWith('outcome_reported', { ...IDS, outcome: 'happened' });
  });

  it('sends a retry of the same answer with the same key, and a new answer with a new one', async () => {
    reportOutcome.mockRejectedValueOnce(new FunctionError(undefined, 'report-outcome failed'));
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Not sure' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("That didn't save. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(reportOutcome).toHaveBeenCalledTimes(2));
    const [first, second] = reportOutcome.mock.calls.map(([input]) => input.key);
    expect(second).toBe(first);
  });

  // Review round 3: a key the server still holds as in flight answers
  // `in_progress` for ever if its first attempt died unclassified. The same
  // answer must be able to go again under a new key — `report_outcome` is
  // idempotent on the answer itself.
  it('lets a save still "in progress" go again under a new key, and says it is going through', async () => {
    reportOutcome.mockRejectedValueOnce(
      new FunctionError(
        { error: 'conflict', reason: 'in_progress', message: 'x', reference: 'R1' } as never,
        'x',
      ),
    );
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'It happened' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText("That's still going through. Give it a moment, then save again."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(TO_CIRCLE));
    const [first, second] = reportOutcome.mock.calls.map(([input]) => input.key);
    expect(second).not.toBe(first);
  });

  it('says so when the meetup changed underneath, and reads it again', async () => {
    reportOutcome.mockRejectedValue(
      new FunctionError(
        {
          error: 'conflict',
          reason: 'confirmation_not_active',
          message: 'x',
          reference: 'R1',
        } as never,
        'x',
      ),
    );
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'It was cancelled' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('This meetup changed since you opened it. Go back and have a look.'),
    ).toBeTruthy();
    await waitFor(() => expect(planConfirmation).toHaveBeenCalledTimes(2));
    expect(dismissTo).not.toHaveBeenCalled();
  });

  const reported = {
    ...fixture.morningAfter,
    state: 'completed' as const,
    confirmation: { ...fixture.morningAfter.confirmation!, status: 'completed' as const },
  };

  it('is told it is answered on a second visit, not offered a form the server would refuse', async () => {
    planConfirmation.mockResolvedValue(reported);
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText('This one has been answered.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    // A member too: their own "were you there?" is still theirs to give.
    fireEvent.click(screen.getByRole('button', { name: 'Say whether you made it' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/p/[code]/attendance',
      params: { code: 'pnsundaycr' },
    });
  });

  // Review round 2: organisers are members, and may say whether they were there.
  it('answers as a member on the attendance door, once the outcome is in', async () => {
    planConfirmation.mockResolvedValue(reported);
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} door="attendance" />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));
    await waitFor(() =>
      expect(reportAttendance).toHaveBeenCalledWith(
        expect.objectContaining({ attendance: 'was_there' }),
      ),
    );
  });

  it('is asked the outcome first on the attendance door while it is owed', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} door="attendance" />);
    expect(await screen.findByText("Did Thursday's catch-up happen?")).toBeTruthy();
  });

  it('is not asked before the meetup has finished', async () => {
    planConfirmation.mockResolvedValue(fixture.lockedIn);
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("Thursday's catch-up hasn't finished yet.")).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('a member', () => {
  beforeEach(() => planConfirmation.mockResolvedValue(fixture.morningAfterAsMember));

  it('gets their own question on either door', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText("Did you make it to Thursday's catch-up?")).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('says they were there through report-outcome, and hears the same words either way', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));
    expect(await screen.findByText('Thanks, noted.')).toBeTruthy();
    expect(reportAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationId: 'confirmation-1', attendance: 'was_there' }),
    );
    // The count is the server's, for the funnel — and never on the screen.
    expect(track).toHaveBeenCalledWith('attendance_confirmed', { ...IDS, attended_count: 2 });
    expect(screen.queryByText(/2/)).toBeNull();
  });

  it('lets an answer still "in progress" go again under a new key', async () => {
    reportAttendance.mockRejectedValueOnce(
      new FunctionError(
        { error: 'conflict', reason: 'in_progress', message: 'x', reference: 'R1' } as never,
        'x',
      ),
    );
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));
    expect(
      await screen.findByText("That's still going through. Give it a moment, then try again."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I was there' }));
    expect(await screen.findByText('Thanks, noted.')).toBeTruthy();
    const [first, second] = reportAttendance.mock.calls.map(([input]) => input.key);
    expect(second).not.toBe(first);
  });

  it('after "I was there" on the circle\'s first, asks to start a circle instead of "Thanks, noted."', async () => {
    askToShow.mockResolvedValue({ suppressed: false });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));

    expect(await screen.findByText('Glad it happened.')).toBeTruthy();
    expect(screen.queryByText('Thanks, noted.')).toBeNull();
    expect(askToShow).toHaveBeenCalledWith(
      { moment: 'after_attendance_start_circle', planId: 'thu-17' },
      expect.any(String),
    );
    // One event for the answer, the one there already was: the prompt adds none.
    expect(track.mock.calls.map(([name]) => name)).toEqual(['attendance_confirmed']);

    fireEvent.click(screen.getByRole('button', { name: 'Start a circle' }));
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'after_attendance_start_circle', planId: 'thu-17' },
      'tapped',
      expect.any(String),
    );
    // Maya has a saved place, so there is no gate: straight to the form.
    expect(push).toHaveBeenCalledWith('/circles/create');
  });

  it('"Maybe later" dismisses it and goes to the circle', async () => {
    askToShow.mockResolvedValue({ suppressed: false });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Maybe later' }));

    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'after_attendance_start_circle', planId: 'thu-17' },
      'dismissed',
      expect.any(String),
    );
    expect(dismissTo).toHaveBeenCalledWith(TO_CIRCLE);
  });

  it('never asks after "I couldn\'t make it": only "I was there" is the moment', async () => {
    askToShow.mockResolvedValue({ suppressed: false });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: "I couldn't make it" }));

    expect(await screen.findByText('Thanks, noted.')).toBeTruthy();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('can say they missed it, which records no attendance', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: "I couldn't make it" }));
    expect(await screen.findByText('Thanks, noted.')).toBeTruthy();
    expect(reportAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ attendance: 'missed' }),
    );
    expect(track).not.toHaveBeenCalledWith('attendance_confirmed', expect.anything());
  });

  it('can say "Not now", which this device remembers, and goes to the circle', async () => {
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(TO_CIRCLE));
    expect(setAttendanceDismissed).toHaveBeenCalledWith('priya', 'confirmation-1');
    expect(reportAttendance).not.toHaveBeenCalled();
  });

  it('sees an earlier answer and may change it, with no "Not now"', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.morningAfterAsMember,
      attendance: fixture.morningAfterAsMember.attendance.map((a) =>
        a.userId === 'priya' ? { ...a, status: 'was_there' as const } : a,
      ),
    });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText('You said you were there.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  // Review round 6: the same answer again is a no-op on the server, and must
  // not be counted as a second corroboration.
  it('records "I was there" once, not again for the same answer', async () => {
    planConfirmation.mockResolvedValue({
      ...fixture.morningAfterAsMember,
      attendance: fixture.morningAfterAsMember.attendance.map((a) =>
        a.userId === 'priya' ? { ...a, status: 'was_there' as const } : a,
      ),
    });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I was there' }));
    expect(await screen.findByText('Thanks, noted.')).toBeTruthy();
    expect(track).not.toHaveBeenCalledWith('attendance_confirmed', expect.anything());
  });

  it('is told plainly when the plan never asked them', async () => {
    planConfirmation.mockResolvedValue({ ...fixture.morningAfterAsMember, me: 'nic' });
    show(<MorningAfterFlow target={{ code: 'pnsundaycr' }} />);
    expect(await screen.findByText('This catch-up was arranged before you joined.')).toBeTruthy();
  });
});

describe('the confirmed screen, once the meetup is over', () => {
  it("offers the organiser the way in until they've answered", async () => {
    planConfirmation.mockResolvedValue(fixture.morningAfter);
    show(<ConfirmedFlow target={{ planId: 'thu-17' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Did it happen?' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/outcome',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it('offers a member "Were you there?"', async () => {
    planConfirmation.mockResolvedValue(fixture.morningAfterAsMember);
    show(<ConfirmedFlow target={{ code: 'pnsundaycr' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Were you there?' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/p/[code]/attendance',
      params: { code: 'pnsundaycr' },
    });
  });
});
