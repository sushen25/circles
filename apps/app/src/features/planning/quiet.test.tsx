import { Instant, QuietViewResponse } from '@circles/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';
import * as fixture from './fixtures';

/**
 * The quiet ask's screens (S2-03, spec §5.4). The server is mocked: what is
 * asserted is which screen a view draws, what each tap sends, and that no
 * screen, request or event says who asked or what anybody answered.
 */

configure({ asyncUtilTimeout: 5_000 });

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = vi.hoisted(() => ({
  current: { status: 'saved', userId: 'tom', isAnonymous: false, isLoading: false },
}));
vi.mock('../../data/auth/session', () => ({ useSession: () => session.current }));

const circleHome = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  circleHome: (...a: unknown[]) => circleHome(...a),
}));
const quietView = vi.fn();
const quietPlan = vi.fn();
const createQuietAsk = vi.fn();
const answerInterest = vi.fn();
const acceptOrganiser = vi.fn();
const cancelPlan = vi.fn();
const lastHappenedPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  quietView: (...a: unknown[]) => quietView(...a),
  quietPlan: (...a: unknown[]) => quietPlan(...a),
  createQuietAsk: (...a: unknown[]) => createQuietAsk(...a),
  answerInterest: (...a: unknown[]) => answerInterest(...a),
  acceptOrganiser: (...a: unknown[]) => acceptOrganiser(...a),
  cancelPlan: (...a: unknown[]) => cancelPlan(...a),
  lastHappenedPlan: (...a: unknown[]) => lastHappenedPlan(...a),
}));

// The gate is `growth.test.tsx`'s. Here, only that it is drawn in place of the
// screen for a guest, and that the tap goes on for a saved place.
vi.mock('../growth/InitiateGateFlow', async () => {
  const { Text } = await import('react-native');
  const React = await import('react');
  const Gate = (props: { intent: string; circleId?: string | undefined }) => (
    <Text>{`organiser gate: ${props.intent} in ${props.circleId ?? '?'}`}</Text>
  );
  return {
    InitiateGateFlow: Gate,
    useOrganiserGate: (options: { circleId?: string }) => {
      const [waiting, setWaiting] = React.useState(false);
      return {
        gate: waiting ? <Gate intent="plan" circleId={options.circleId} /> : null,
        require: (action: () => void) =>
          session.current.status === 'guest' ? setWaiting(true) : action(),
      };
    },
  };
});

const { QuietPlanFlow } = await import('./QuietPlanFlow');
const { QuietSetupFlow } = await import('./QuietSetupFlow');
const { ChooseModeFlow } = await import('./ChooseModeFlow');
const { forgetEveryAsk, quietScreenOf, rememberAsked } = await import('./quiet');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const CIRCLE = 'sunday-crew';
const PLAN = 'quiet-plan';
const HOME = {
  id: CIRCLE,
  name: 'Sunday Crew',
  status: 'active',
  zone: 'Australia/Melbourne',
  defaultDurationMinutes: 120,
  defaultQuorum: null,
  me: 'tom',
  isOwner: false,
  members: fixture.sundayCrew.people.map((p) => ({ userId: p.id, name: p.name })),
  activePlan: null,
  mine: { mutedAll: false, mutedQuietAsks: false, mutedNudges: false },
};
const ROW: Planning.QuietPlan = {
  id: PLAN,
  circleId: CIRCLE,
  code: 'pnquietask',
  mode: 'quiet',
  state: 'seeking',
  organiserUserId: null,
  preset: 'this_weekend',
  zone: 'Australia/Melbourne',
  responseDeadline: '2026-09-18T02:00:00.000Z',
};
const SEEKING = {
  phase: 'seeking' as const,
  closes_at: Instant.parse('2026-09-18T02:00:00.000Z'),
  threshold: 3,
  answered_by_me: false,
  may_withdraw: false,
};
const OPENED = {
  phase: 'opened' as const,
  keen_count: 3,
  organiser: null,
  may_take_role: true,
};

/** Every key and value a screen, a request or an event could carry. */
function everythingSaid(): string {
  return JSON.stringify([
    document.body.textContent,
    track.mock.calls,
    answerInterest.mock.calls,
    acceptOrganiser.mock.calls,
    cancelPlan.mock.calls,
    createQuietAsk.mock.calls,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetEveryAsk();
  session.current = { status: 'saved', userId: 'tom', isAnonymous: false, isLoading: false };
  vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW);
  circleHome.mockResolvedValue(HOME);
  quietPlan.mockResolvedValue(ROW);
  quietView.mockResolvedValue(SEEKING);
  lastHappenedPlan.mockResolvedValue(null);
  answerInterest.mockResolvedValue(undefined);
  acceptOrganiser.mockResolvedValue(undefined);
  cancelPlan.mockResolvedValue(undefined);
  createQuietAsk.mockResolvedValue({ plan_id: 'new-ask', short_code: 'pnnewask' });
});
afterEach(() => vi.restoreAllMocks());

describe('what a view draws', () => {
  it('holds a view to its fixed keys: no initiator, no answer, not even for the one who asked', () => {
    // The contract is strict: a server that let `is_initiator` or `my_answer`
    // slip into the view would fail here, not reach a screen.
    for (const extra of [{ is_initiator: true }, { my_answer: 'keen' }, { initiator_id: 'maya' }]) {
      expect(QuietViewResponse.safeParse({ view: { ...SEEKING, ...extra } }).success).toBe(false);
      expect(QuietViewResponse.safeParse({ view: { ...OPENED, ...extra } }).success).toBe(false);
    }
    expect(QuietViewResponse.safeParse({ view: SEEKING }).success).toBe(true);
  });

  it('turns capabilities into screens, and the same capability into the same screen', () => {
    const row = { id: PLAN, organiserUserId: null };
    expect(quietScreenOf({ ...SEEKING, may_withdraw: true }, row, 'maya').kind).toBe('waiting');
    expect(quietScreenOf(SEEKING, row, 'tom')).toMatchObject({ kind: 'prompt', answered: false });
    // A keen member and the initiator both may take the role: one screen for
    // both, unless this device watched its own ask open.
    expect(quietScreenOf(OPENED, row, 'maya').kind).toBe('volunteer');
    rememberAsked(PLAN, 'maya');
    expect(quietScreenOf(OPENED, row, 'maya').kind).toBe('threshold');
    // Signed out and into another account in the same tab: not theirs.
    expect(quietScreenOf(OPENED, row, 'tom').kind).toBe('volunteer');
    expect(quietScreenOf({ ...OPENED, may_take_role: false }, row, 'tom').kind).toBe('opened');
    expect(
      quietScreenOf(
        { ...OPENED, organiser: 'Tom', may_take_role: false },
        {
          id: PLAN,
          organiserUserId: 'tom',
        },
        'tom',
      ).kind,
    ).toBe('organising');
    expect(quietScreenOf({ phase: 'closed', show_closed_notice: true }, row, 'maya').kind).toBe(
      'closed_notice',
    );
    expect(quietScreenOf({ phase: 'closed', show_closed_notice: false }, row, 'tom').kind).toBe(
      'closed',
    );
  });
});

describe('the person who asked (SparkWaiting)', () => {
  beforeEach(() => {
    session.current = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
    quietView.mockResolvedValue({ ...SEEKING, may_withdraw: true, threshold: 4 });
  });

  it('sees when it closes and what opens it, from the view, and no count', async () => {
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(
      await screen.findByText("We're checking who's keen for a catch-up this weekend."),
    ).toBeTruthy();
    // The threshold is the view's, not three.
    expect(screen.getByText('4 people are keen')).toBeTruthy();
    expect(screen.queryByText(/so far/)).toBeNull();
  });

  it('withdraws through cancel-plan with no note, and records nothing against them', async () => {
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw the ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(cancelPlan).toHaveBeenCalledTimes(1));
    expect(cancelPlan.mock.calls[0]?.[0]).toBe(PLAN);
    expect(cancelPlan.mock.calls[0]?.[1]).toBeUndefined();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } }),
    );
    // `plan_cancelled` beside their id would say who asked.
    expect(track).not.toHaveBeenCalled();
  });

  it('is offered the initiator’s choice when their ask opens in front of them', async () => {
    const waiting = show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);
    await screen.findByText('4 people are keen');
    waiting.unmount();

    // The next read on this device — the poll, or coming back to it — sees it open.
    quietView.mockResolvedValue(OPENED);
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);
    expect(await screen.findByText('Enough people are keen.')).toBeTruthy();
    expect(screen.getByText(/3 of you want to catch up this weekend/)).toBeTruthy();
  });
});

describe('everybody else, while it asks (InterestPrompt)', () => {
  it('answers with a new key per tap, then reads the view again', async () => {
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(
      await screen.findByText(
        'Someone in Sunday Crew would be up for a catch-up this weekend. Would you?',
      ),
    ).toBeTruthy();
    quietView.mockResolvedValue({ ...SEEKING, answered_by_me: true });
    fireEvent.click(screen.getByRole('button', { name: "I'm keen" }));

    expect(await screen.findByText("Thanks. We'll let you know if it opens up.")).toBeTruthy();
    expect(answerInterest.mock.calls[0]?.slice(0, 2)).toEqual([PLAN, true]);
    expect(quietView.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Changing it is both buttons again, under a key of its own.
    fireEvent.click(screen.getByRole('button', { name: 'Change my answer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not this time' }));
    await waitFor(() => expect(answerInterest).toHaveBeenCalledTimes(2));
    expect(answerInterest.mock.calls[1]?.slice(0, 2)).toEqual([PLAN, false]);
    expect(answerInterest.mock.calls[1]?.[2]).not.toBe(answerInterest.mock.calls[0]?.[2]);
  });

  it('never says which answer was given, or records it', async () => {
    quietView.mockResolvedValue({ ...SEEKING, answered_by_me: true });
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);
    await screen.findByText("Thanks. We'll let you know if it opens up.");

    fireEvent.click(screen.getByRole('button', { name: 'Change my answer' }));
    fireEvent.click(await screen.findByRole('button', { name: "I'm keen" }));
    await waitFor(() => expect(track).toHaveBeenCalled());

    // Nothing: no answer, no plan, and (in the transport) nobody on the row.
    expect(track).toHaveBeenCalledWith('quiet_interest_answered', {});
    expect(screen.queryByText(/you said/i)).toBeNull();
  });
});

describe('once it opens', () => {
  it('lets a keen member pick the time: no role sent, none recorded, then the ask-for-times message', async () => {
    quietView.mockResolvedValue(OPENED);
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(await screen.findByText('3 people are keen to catch up this weekend.')).toBeTruthy();
    expect(screen.getByText("3 said they're keen. We don't show who.")).toBeTruthy();
    expect(screen.queryByText(/so far/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "I'll pick the time" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id: CIRCLE, planId: PLAN },
      }),
    );
    expect(acceptOrganiser.mock.calls[0]?.[0]).toBe(PLAN);
    expect(track).toHaveBeenCalledWith('organiser_accepted', { circle_id: CIRCLE, plan_id: PLAN });
  });

  it('shows a guest the organiser gate before the tap goes anywhere', async () => {
    session.current = { status: 'guest', userId: 'alex', isAnonymous: true, isLoading: false };
    quietView.mockResolvedValue(OPENED);
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: "I'll pick the time" }));

    expect(await screen.findByText(`organiser gate: plan in ${CIRCLE}`)).toBeTruthy();
    expect(acceptOrganiser).not.toHaveBeenCalled();
  });

  it('tells a member who was not keen who is picking, and sends them to their times', async () => {
    quietView.mockResolvedValue({ ...OPENED, organiser: 'Jess', may_take_role: false });
    quietPlan.mockResolvedValue({ ...ROW, state: 'collecting', organiserUserId: 'jess' });
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(await screen.findByText(/^Jess volunteered to pick the time/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose my times' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'pnquietask' } });
  });

  it('says somebody got there first, and reads the view again', async () => {
    quietView.mockResolvedValue(OPENED);
    const { FunctionError } = await import('../../data/functions');
    acceptOrganiser.mockRejectedValue(
      new FunctionError(
        { error: 'conflict', reason: 'already_taken', message: 'x', reference: 'R1' } as never,
        'x',
      ),
    );
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: "I'll pick the time" }));

    expect(await screen.findByText('Someone else has just taken it on.')).toBeTruthy();
    expect(quietView.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('once it closes', () => {
  it('tells the person who asked, and only them (SparkExpired)', async () => {
    quietView.mockResolvedValue({ phase: 'closed', show_closed_notice: true });
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(await screen.findByText('Not enough people were free this time.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again another time' }));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/quiet/new',
      params: { id: CIRCLE },
    });
  });

  it('is one neutral page to everybody else, whatever closed it', async () => {
    quietView.mockResolvedValue({ phase: 'closed', show_closed_notice: false });
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(await screen.findByText("This isn't open any more.")).toBeTruthy();
    expect(screen.queryByText('Not enough people were free this time.')).toBeNull();
    expect(everythingSaid()).not.toMatch(/initiator|asked by|Maya asked/i);
  });
});

describe('SparkSetup', () => {
  it('asks quietly with a stop-time option, no organiser fields, and nobody on the event', async () => {
    show(<QuietSetupFlow id={CIRCLE} />);

    expect(await screen.findByText(/If 3 people are keen, it opens up/)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Friday midday' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Ask quietly' }));

    await waitFor(() => expect(createQuietAsk).toHaveBeenCalledTimes(1));
    const sent = createQuietAsk.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      circleId: CIRCLE,
      preset: 'this_weekend',
      stopTime: 'friday_midday',
      category: 'catch_up',
    });
    for (const field of ['quorum', 'requiredMemberIds', 'responseDeadline', 'custom']) {
      expect(sent).not.toHaveProperty(field);
    }
    expect(track).toHaveBeenCalledWith('quiet_ask_created', {});
    expect(track).not.toHaveBeenCalledWith('plan_created', expect.anything());
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/quiet/[planId]',
      params: { id: CIRCLE, planId: 'new-ask' },
    });
  });

  it('offers only the stop times the window has, and says why there are none', async () => {
    // 9 pm in Melbourne: tonight still has a start, but no stop time before it.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-15T11:00:00.000Z'));
    show(<QuietSetupFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tonight' }));

    expect(
      await screen.findByText('Too late to ask quietly about tonight. Pick a later window.'),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Tonight, 9 pm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask quietly' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('is a statement, not a form, in a circle of one', async () => {
    circleHome.mockResolvedValue({ ...HOME, members: HOME.members.slice(0, 1) });
    show(<QuietSetupFlow id={CIRCLE} />);

    expect(await screen.findByText("There's nobody else in Sunday Crew to ask yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask quietly' })).toBeNull();
  });

  it('draws the organiser gate in place of the form for a guest', async () => {
    session.current = { status: 'guest', userId: 'alex', isAnonymous: true, isLoading: false };
    show(<QuietSetupFlow id={CIRCLE} />);

    expect(await screen.findByText(`organiser gate: plan in ${CIRCLE}`)).toBeTruthy();
  });

  it('renders a refusal about the reader as copy, and only to them', async () => {
    const { FunctionError } = await import('../../data/functions');
    createQuietAsk.mockRejectedValue(
      new FunctionError(
        { error: 'conflict', reason: 'already_asking', message: 'x', reference: 'R1' } as never,
        'x',
      ),
    );
    show(<QuietSetupFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ask quietly' }));

    expect(
      await screen.findByText(
        'You already have a quiet ask open in Sunday Crew. It has to close first.',
      ),
    ).toBeTruthy();
    expect(track).not.toHaveBeenCalled();
  });
});

describe('ChooseMode', () => {
  it('offers the quiet card with this circle’s threshold, and a guest meets the gate', async () => {
    session.current = { status: 'guest', userId: 'alex', isAnonymous: true, isLoading: false };
    show(<ChooseModeFlow id={CIRCLE} />);

    const card = await screen.findByRole('button', { name: /^See if people are keen\./ });
    expect(card.getAttribute('aria-label')).toMatch(/If 3 people are keen/);
    fireEvent.click(card);

    expect(await screen.findByText(`organiser gate: plan in ${CIRCLE}`)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('goes straight to the setup for a saved place', async () => {
    show(<ChooseModeFlow id={CIRCLE} />);

    fireEvent.click(await screen.findByRole('button', { name: /^See if people are keen\./ }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/quiet/new',
      params: { id: CIRCLE },
    });
  });

  it('has no quiet card in a circle of one', async () => {
    circleHome.mockResolvedValue({ ...HOME, members: HOME.members.slice(0, 1) });
    show(<ChooseModeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: /^Plan openly\./ })).toBeTruthy();
    await waitFor(() => expect(circleHome).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^See if people are keen\./ })).toBeNull();
  });
});

describe('ChooseMode beside a running plan', () => {
  it('is that plan, with neither way to start another (ADR 0033)', async () => {
    circleHome.mockResolvedValue({
      ...HOME,
      activePlan: {
        id: 'running',
        code: 'pnrunning',
        title: 'Catch up',
        organiserUserId: 'maya',
        responseDeadline: '2026-09-20T08:00:00.000Z',
        replied: 1,
        asked: 6,
      },
    });
    show(<ChooseModeFlow id={CIRCLE} />);

    expect(await screen.findByText('Sunday Crew is already finding a time')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^See if people are keen\./ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Plan openly\./ })).toBeNull();
  });
});

describe('reads that disagree or fail', () => {
  it('is not this plan’s page under another circle’s URL', async () => {
    show(<QuietPlanFlow planId={PLAN} circleId="another-circle" />);

    await waitFor(() => expect(quietPlan).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Someone in/)).toBeNull());
    expect(circleHome).not.toHaveBeenCalledWith('another-circle');
    expect(screen.queryByRole('button', { name: "I'm keen" })).toBeNull();
  });

  it('says it could not load, with a retry, when the circle cannot be read', async () => {
    circleHome.mockRejectedValue(new Error('circle lookup failed'));
    show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "I'm keen" })).toBeNull();
  });

  it('reads the plan again when the ask opens, for the deadline it opened with', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);
      await screen.findByRole('button', { name: "I'm keen" });
      const reads = quietPlan.mock.calls.length;

      // Somebody else's answer opens it; this member was not keen.
      quietView.mockResolvedValue({ ...OPENED, may_take_role: false });
      quietPlan.mockResolvedValue({
        ...ROW,
        state: 'collecting',
        responseDeadline: '2026-09-20T08:00:00.000Z',
      });
      await vi.advanceTimersByTimeAsync(31_000);

      await waitFor(() => expect(quietPlan.mock.calls.length).toBeGreaterThan(reads));
      expect(await screen.findByText(/^3 were keen · Replies close .*\b20\b/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the plan again when the view says somebody organises it, and sends its organiser on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      quietView.mockResolvedValue(OPENED);
      show(<QuietPlanFlow planId={PLAN} circleId={CIRCLE} />);
      await screen.findByRole('button', { name: "I'll pick the time" });
      const reads = quietPlan.mock.calls.length;

      // Tom took it on another device; the next poll sees it.
      quietView.mockResolvedValue({ ...OPENED, organiser: 'Tom', may_take_role: false });
      quietPlan.mockResolvedValue({ ...ROW, state: 'collecting', organiserUserId: 'tom' });
      await vi.advanceTimersByTimeAsync(31_000);

      await waitFor(() => expect(quietPlan.mock.calls.length).toBeGreaterThan(reads));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith({
          pathname: '/circles/[id]/plan/[planId]/candidates',
          params: { id: CIRCLE, planId: PLAN },
        }),
      );
      expect(acceptOrganiser).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChooseMode while the circle is read', () => {
  it('says it could not load, rather than drawing a circle of one', async () => {
    circleHome.mockRejectedValue(new Error('circle lookup failed'));
    show(<ChooseModeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Plan openly\./ })).toBeNull();
  });

  it('offers no quiet card in an archived circle (the domain’s order)', async () => {
    circleHome.mockResolvedValue({ ...HOME, status: 'archived' });
    show(<ChooseModeFlow id={CIRCLE} />);

    expect(await screen.findByRole('button', { name: /^Plan openly\./ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^See if people are keen\./ })).toBeNull();
  });
});
