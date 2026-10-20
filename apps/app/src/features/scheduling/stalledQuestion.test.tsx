import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';
import { tap } from '../../test/tap';

/**
 * SUS-240, part 3: "Nothing in yet. What's happened?", the one optional question
 * on a first plan's waiting screen, once it is 48 hours old and nobody but its
 * organiser has answered. The rule is `firstPlanQuiet` in the domain; this walks
 * the screen on both sides of it, for the organiser and for a member.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const planCandidates = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
}));
const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const { CandidatesFlow } = await import('./CandidatesFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const fixture = await import('./fixtures');

const HOUR = 3_600_000;
const QUESTION = "Nothing in yet. What's happened?";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />
    </QueryClientProvider>,
  );
}

/** The organiser's waiting screen: only Maya's own times in, a plan `age` hours old. */
function waitingFor(age: number, overrides: object = {}) {
  return {
    ...fixture.waiting,
    createdAt: new Date(Date.now() - age * HOUR).toISOString(),
    isFirstPlan: true,
    responded: ['maya'],
    repliedCount: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetSessionNudges();
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
});

describe('the organiser of a first plan nobody has answered', () => {
  it('is asked one question after 48 hours: three answers, Skip, and no field', async () => {
    planCandidates.mockResolvedValue(waitingFor(49));
    show();

    expect(await screen.findByText(QUESTION)).toBeTruthy();
    for (const answer of [
      "I haven't posted the link yet",
      "I posted it, no one's replied",
      "This isn't the right group for it",
    ]) {
      expect(screen.getByRole('checkbox', { name: answer })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(askToShow).toHaveBeenCalledWith(
      { moment: 'first_plan_stalled', planId: 'thu-17' },
      expect.anything(),
    );
  });

  it('is not asked before 48 hours, and the server is not even asked', async () => {
    planCandidates.mockResolvedValue(waitingFor(47));
    show();

    expect(await screen.findByText('Share the link again')).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('is not asked once anyone else has answered', async () => {
    planCandidates.mockResolvedValue(
      waitingFor(60, { responded: ['maya', 'nina'], repliedCount: 2 }),
    );
    show();

    expect(await screen.findByText('Share the link again')).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('is not asked about a circle’s later plans', async () => {
    planCandidates.mockResolvedValue(waitingFor(60, { isFirstPlan: false }));
    show();

    expect(await screen.findByText('Share the link again')).toBeTruthy();
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('is not asked again once the server says it was shown', async () => {
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    planCandidates.mockResolvedValue(waitingFor(60));
    show();

    expect(await screen.findByText('Share the link again')).toBeTruthy();
    await waitFor(() => expect(askToShow).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('records the answer as an event with the word and nothing else, and goes away', async () => {
    planCandidates.mockResolvedValue(waitingFor(60));
    show();

    await tap(screen.findByRole('checkbox', { name: "I posted it, no one's replied" }));

    expect(track).toHaveBeenCalledWith('first_plan_stalled', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
      answer: 'posted_no_replies',
    });
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'first_plan_stalled', planId: 'thu-17' },
      'tapped',
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
  });

  it('records nothing on Skip but that the question was put, and goes away', async () => {
    planCandidates.mockResolvedValue(waitingFor(60));
    show();

    await tap(screen.findByRole('button', { name: 'Skip' }));

    expect(track).not.toHaveBeenCalledWith('first_plan_stalled', expect.anything());
    expect(recordAnswer).toHaveBeenCalledWith(
      { moment: 'first_plan_stalled', planId: 'thu-17' },
      'dismissed',
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
  });

  it('never stands in the way of anything else on the screen', async () => {
    planCandidates.mockResolvedValue(waitingFor(60));
    show();

    expect(await screen.findByText(QUESTION)).toBeTruthy();
    expect(screen.getByText('Share the link again')).toBeTruthy();
    expect(screen.getByText('Set the time yourself')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change my times' })).toBeTruthy();
  });
});

describe('a member of the circle', () => {
  it('never sees the question, however quiet the plan', async () => {
    planCandidates.mockResolvedValue({
      ...waitingFor(120),
      isOrganiser: false,
      isOwner: false,
      me: 'nina',
      organiserUserId: 'maya',
      responded: null,
    });
    show();

    await waitFor(() => expect(planCandidates).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(askToShow).not.toHaveBeenCalled();
  });
});
