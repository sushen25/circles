import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tap } from '../../test/tap';
import type * as CircleData from '../../data/circles';
import type * as Planning from '../../data/planning';

/**
 * "How did you hear about {brand}?" (SUS-171) is the LAST step of the first run
 * (moved from straight after the code on 21 October): after the account, the
 * circle and the plan exist, and just before the person lands in the circle.
 * Optional, one tap and Skip (ADR 0061), once per account, skipped for a tagged
 * arrival (SUS-240), and nothing waits on it.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    useFocusEffect: (effect: () => void) => {
      useEffect(() => effect(), [effect]);
    },
  };
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya' as string | undefined, isLoading: false };
const ownProfile = vi.fn();
vi.mock('../../data/auth', async () => {
  const { guard } = await import('../../data/auth/guards');
  return {
    guard,
    useSession: () => session,
    deviceTimeZone: () => 'Australia/Melbourne',
    ownProfile: () => ownProfile(),
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const createCircle = vi.fn();
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  createCircle: (...a: unknown[]) => createCircle(...a),
}));
const createPlan = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  createPlan: (...a: unknown[]) => createPlan(...a),
}));
const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { brand } = await import('@circles/config');
const { FinishDraftFlow } = await import('./FinishDraftFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const { keepArrivalTag, readArrivalTag, readDraft, saveDraft } = await import('../../data/draft');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
const SHARED = {
  pathname: '/circles/[id]/plan/[planId]/shared',
  params: { id: CIRCLE, planId: PLAN },
};
const QUESTION = `How did you hear about ${brand.name}?`;
const TAG = 'tt-always-the-one-3';

const asked = () => askToShow.mock.calls.map(([target]) => target);
const sourceEvents = () => track.mock.calls.filter(([name]) => name === 'organiser_source');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function firstRun(way: 'ask' | 'invite' = 'ask') {
  await saveDraft({ circleName: 'Sunday Crew', cadence: 'fortnightly', way, proceed: true });
  wrap(<FinishDraftFlow />);
}

beforeEach(() => {
  globalThis.localStorage.clear();
  Object.assign(session, { status: 'saved', userId: 'maya', isLoading: false });
  for (const mock of [push, replace, track, createCircle, createPlan, ownProfile, askToShow]) {
    mock.mockReset();
  }
  recordAnswer.mockReset();
  ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Europe/London' });
  createCircle.mockResolvedValue({ circle: { id: CIRCLE }, invite_secret: 'x' });
  createPlan.mockResolvedValue({ plan_id: PLAN });
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
  forgetSessionNudges();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('"How did you hear about {brand}?" as the last step of the first run', () => {
  it('is asked after the circle and the plan exist, and before the person lands in the circle', async () => {
    await firstRun();
    expect(await screen.findByText(QUESTION)).toBeVisible();
    expect(createCircle).toHaveBeenCalledTimes(1);
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    // The draft is kept until the question is out of the way, so a reload here
    // runs the finish again (it makes nothing twice) and lands in the circle.
    expect(await readDraft()).not.toBeNull();
    expect(asked()).toEqual([{ moment: 'organiser_source', planId: undefined }]);
    for (const name of ["A friend's group", 'Reddit', 'A meetup or club', 'Somewhere else']) {
      expect(screen.getByRole('checkbox', { name })).toBeVisible();
    }
    expect(screen.getByRole('button', { name: 'Skip' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('records one tap on an answer and lands in the circle', async () => {
    await firstRun();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reddit' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
    expect(sourceEvents()).toEqual([['organiser_source', { source: 'reddit' }]]);
    // The account's own record says it was answered, the same for every choice.
    expect(recordAnswer).toHaveBeenCalledTimes(1);
    expect(recordAnswer.mock.calls[0]?.[0]).toEqual({
      moment: 'organiser_source',
      planId: undefined,
    });
    expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
    expect(await readDraft()).toBeNull();
  });

  it('records a skip as skipped and lands in the circle', async () => {
    await firstRun();
    await tap(screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
    expect(sourceEvents()).toEqual([['organiser_source', { source: 'skipped' }]]);
    expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
  });

  it('is also the last step before the invite, for Just invite people', async () => {
    await firstRun('invite');
    expect(await screen.findByText(QUESTION)).toBeVisible();
    expect(createPlan).not.toHaveBeenCalled();
    await tap(screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/circles/[id]/invite',
        params: { id: CIRCLE },
      }),
    );
  });

  it('counts a choice once, whatever else is tapped', async () => {
    await firstRun();
    const meetup = await screen.findByRole('checkbox', { name: 'A meetup or club' });
    fireEvent.click(meetup);
    fireEvent.click(meetup);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(sourceEvents()).toHaveLength(1);
  });

  it('lands in the circle without the question when the server never answers, rather than waiting for ever', async () => {
    askToShow.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await firstRun();
    await waitFor(() => expect(createPlan).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(replace).toHaveBeenCalledWith(SHARED);
    expect(sourceEvents()).toEqual([]);
  });

  it('is not asked again of an account that was asked before, and counts nothing', async () => {
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    await firstRun();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(sourceEvents()).toEqual([]);
  });

  it('does not block on a server that cannot be asked', async () => {
    askToShow.mockRejectedValue(new Error('offline'));
    await firstRun();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
    expect(sourceEvents()).toEqual([]);
  });

  it('leaves it unanswered, and nothing treated as a value, when the person walks away at the question', async () => {
    await firstRun();
    expect(await screen.findByText(QUESTION)).toBeVisible();
    cleanup();
    expect(sourceEvents()).toEqual([]);
    expect(recordAnswer).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('error', expect.anything());
  });

  describe('arriving on a tagged link (SUS-240)', () => {
    it('is not asked: the post is the answer, recorded as content, and counts as asked', async () => {
      await keepArrivalTag(TAG);
      await firstRun();
      await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
      expect(screen.queryByText(QUESTION)).toBeNull();
      // The tag went to the circle when it was made, and the question knew of it.
      expect(createCircle).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: TAG }));
      expect(sourceEvents()).toEqual([['organiser_source', { source: 'content' }]]);
      expect(recordAnswer).toHaveBeenCalledTimes(1);
      expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
      expect(await readArrivalTag()).toBeUndefined();
    });

    it('puts the tag itself in no event', async () => {
      await keepArrivalTag(TAG);
      await firstRun();
      await waitFor(() => expect(replace).toHaveBeenCalled());
      expect(JSON.stringify(track.mock.calls)).not.toContain(TAG);
      expect(JSON.stringify(recordAnswer.mock.calls)).not.toContain(TAG);
    });

    it('records nothing for an account that was asked before, tag or not', async () => {
      await keepArrivalTag(TAG);
      askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
      await firstRun();
      await waitFor(() => expect(replace).toHaveBeenCalledWith(SHARED));
      expect(sourceEvents()).toEqual([]);
    });

    it('asks as for anyone when the tag was malformed, because none was kept', async () => {
      await keepArrivalTag('Not A Slug!');
      await firstRun();
      expect(await screen.findByText(QUESTION)).toBeVisible();
      expect(sourceEvents()).toEqual([]);
    });
  });
});
