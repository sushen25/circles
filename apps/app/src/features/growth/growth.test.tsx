import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guest → saved place (S2-07): the organiser gate, "Keep your place for
 * good?" and the rule that one session has one prompt. What `record-nudge`
 * decides is its own suite's; here `askToShow` is a server that says yes, and
 * what is proved is what each screen asks, what it records, and where it goes.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));

const session = { status: 'guest', userId: 'priya', isAnonymous: true, isLoading: false };
const savePlace = vi.fn();
const requestLinkCode = vi.fn();
const bootstrapProfile = vi.fn();
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  const { SavePlaceError } = await import('../../data/auth/link');
  return {
    guard,
    SavePlaceError,
    useSession: () => session,
    savePlace: (...a: unknown[]) => savePlace(...a),
    requestLinkCode: (...a: unknown[]) => requestLinkCode(...a),
    submitLinkCode: vi.fn(),
    bootstrapProfile: (...a: unknown[]) => bootstrapProfile(...a),
  };
});
vi.mock('../../data/membership', () => ({ ownNameIn: async () => 'Priya' }));
vi.mock('../../data/circles', () => ({
  newestCircleId: async () => 'sunday-crew',
  belongsToAnyCircle: async () => true,
}));
const planToAnswer = vi.fn();
vi.mock('../../data/availability', () => ({
  planToAnswer: (...a: unknown[]) => planToAnswer(...a),
}));

const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { InitiateGateFlow, useOrganiserGate } = await import('./InitiateGateFlow');
const { ReattachedNudgeFlow } = await import('./ReattachedNudgeFlow');
const { forgetSessionNudges, useNudge } = await import('./useNudge');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

const PLAN = { id: 'thu-17', circleId: 'sunday-crew', circleName: 'Sunday Crew' };

beforeEach(() => {
  for (const mock of [push, replace, track, savePlace, requestLinkCode, bootstrapProfile]) {
    mock.mockReset();
  }
  Object.assign(session, { status: 'guest', userId: 'priya', isAnonymous: true });
  forgetSessionNudges();
  askToShow.mockReset().mockResolvedValue({ suppressed: false });
  recordAnswer.mockReset().mockResolvedValue(undefined);
  requestLinkCode.mockResolvedValue({ kind: 'link' });
  savePlace.mockResolvedValue({ mergedMemberships: 0, duplicatesRemoved: 0 });
  bootstrapProfile.mockResolvedValue(undefined);
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: { status: 'flexible', windows: [] } });
});

describe('the organiser gate', () => {
  it('asks a guest to save their place, as the name the circle knows them by', async () => {
    const notNow = vi.fn();
    wrap(
      <InitiateGateFlow
        intent="plan"
        circleId="sunday-crew"
        circleName="Sunday Crew"
        onNotNow={notNow}
      />,
    );

    expect(await screen.findByText('Save your place first')).toBeVisible();
    expect(
      await screen.findByText(
        "This links your existing place as Priya. Nothing you've sent changes.",
      ),
    ).toBeVisible();
    // Apple and Google are S1-14b's: no button that goes nowhere.
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    await waitFor(() =>
      expect(askToShow).toHaveBeenCalledWith({ moment: 'organiser_gate' }, expect.any(String)),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(notNow).toHaveBeenCalled();
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'organiser_gate' },
      'dismissed',
      expect.any(String),
    );
  });

  it('saves the place at the gate, names the profile after the membership, and says so', async () => {
    const saved = vi.fn();
    wrap(
      <InitiateGateFlow
        intent="circle"
        circleId="sunday-crew"
        onSaved={saved}
        onNotNow={vi.fn()}
      />,
    );
    await screen.findByText(
      "This links your existing place as Priya. Nothing you've sent changes.",
    );
    expect(screen.getByText(/^Starting a circle makes you its owner/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with email' }));
    fireEvent.change(await screen.findByLabelText('Your email'), {
      target: { value: 'priya@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    });
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(savePlace).toHaveBeenCalledWith(expect.objectContaining({ moment: 'organiser_gate' }));
    expect(bootstrapProfile).toHaveBeenCalledWith({ name: 'Priya' });
    expect(track).toHaveBeenCalledWith('account_claimed', { moment: 'organiser_gate' });
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'organiser_gate' },
      'tapped',
      expect.any(String),
    );
  });
});

function Organise({ action }: { action: () => void }) {
  const organiser = useOrganiserGate({ circleId: 'sunday-crew', circleName: 'Sunday Crew' });
  if (organiser.gate !== null) return <>{organiser.gate}</>;
  return (
    <Text accessibilityRole="button" onPress={() => organiser.require(action)}>
      {'I’ll pick the time'}
    </Text>
  );
}

describe('useOrganiserGate, the door SUS-51 plugs its taps into', () => {
  it('lets a saved place straight through to the action', async () => {
    Object.assign(session, { status: 'saved', isAnonymous: false });
    const action = vi.fn();
    wrap(<Organise action={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'I’ll pick the time' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Save your place first')).toBeNull();
  });

  it('shows a guest the gate, and "Not now" drops the tap', async () => {
    const action = vi.fn();
    wrap(<Organise action={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'I’ll pick the time' }));
    expect(await screen.findByText('Save your place first')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('button', { name: 'I’ll pick the time' })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });
});

describe('Keep your place for good?', () => {
  const page = <Text>{'the plan page'}</Text>;

  it('follows a reattach once the person has answered, and "Carry on" is the page', async () => {
    const done = vi.fn();
    wrap(
      <ReattachedNudgeFlow code="pnsundaycr" onDone={done}>
        {page}
      </ReattachedNudgeFlow>,
    );

    expect(await screen.findByText('Welcome back, Priya.')).toBeVisible();
    expect(askToShow).toHaveBeenCalledWith(
      { moment: 'reattached_save_place', planId: 'thu-17' },
      expect.any(String),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Carry on to Sunday Crew' }));
    expect(done).toHaveBeenCalled();
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'reattached_save_place', planId: 'thu-17' },
      'dismissed',
      expect.any(String),
    );
  });

  it('never stands in front of an answer: somebody who has not answered sees the page', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
    wrap(
      <ReattachedNudgeFlow code="pnsundaycr" onDone={vi.fn()}>
        {page}
      </ReattachedNudgeFlow>,
    );

    expect(await screen.findByText('the plan page')).toBeVisible();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('shows the page when record-nudge says it has been shown before', async () => {
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    wrap(
      <ReattachedNudgeFlow code="pnsundaycr" onDone={vi.fn()}>
        {page}
      </ReattachedNudgeFlow>,
    );
    expect(await screen.findByText('the plan page')).toBeVisible();
    expect(screen.queryByText('Keep your place for good?')).toBeNull();
  });
});

function Prompt({
  moment,
  plan,
}: {
  moment: 'after_attendance_start_circle' | 'reattached_save_place';
  plan: string;
}) {
  const nudge = useNudge(moment, { planId: plan });
  return <Text>{`${moment}: ${nudge.showing}`}</Text>;
}

describe('one prompt per session', () => {
  it('holds a second prompt without asking the server, and lets the email card through', async () => {
    const first = wrap(<Prompt moment="after_attendance_start_circle" plan="thu-17" />);
    expect(await screen.findByText('after_attendance_start_circle: show')).toBeVisible();
    first.unmount();

    askToShow.mockClear();
    wrap(<Prompt moment="reattached_save_place" plan="oct-15" />);
    expect(await screen.findByText('reattached_save_place: skip')).toBeVisible();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('is the same prompt, not a second, when its own screen is mounted again', async () => {
    const first = wrap(<Prompt moment="after_attendance_start_circle" plan="thu-17" />);
    await screen.findByText('after_attendance_start_circle: show');
    first.unmount();

    wrap(<Prompt moment="after_attendance_start_circle" plan="thu-17" />);
    expect(await screen.findByText('after_attendance_start_circle: show')).toBeVisible();
  });
});
