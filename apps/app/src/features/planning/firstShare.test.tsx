import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Planning from '../../data/planning';

/**
 * The first run's share (SUS-247, ADR 0090): "Ask {group}." and the bubble with
 * the real link, one line about when replies close, **Share to group chat** and
 * **Copy**; and, once the share sheet closes, "Over to {group}.", the source
 * question as a quiet card, **Go to {group}** and **Share again**. **Add my
 * times** only when the organiser chose to answer later.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
vi.mock('../../data/links/origin', () => ({ appOrigin: () => 'https://circles.test' }));
const planToShare = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  planToShare: (...a: unknown[]) => planToShare(...a),
}));
const shareMessage = vi.fn();
const copyText = vi.fn();
vi.mock('../../platform/share', () => ({
  shareMessage: (...a: unknown[]) => shareMessage(...a),
  copyText: (...a: unknown[]) => copyText(...a),
}));
const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { PlanSharedFlow } = await import('./PlanSharedFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');

const CIRCLE = '00000000-0000-4000-8000-00000000c1c1';
const PLAN = '00000000-0000-4000-8000-00000000b1a1';
const PLAN_TO_SHARE = {
  id: PLAN,
  code: 'abcdefgh',
  circleId: CIRCLE,
  circleName: 'Sunday Crew',
  zone: 'Australia/Melbourne',
  // Sunday 25 October, 6 pm in Melbourne.
  responseDeadline: '2026-10-25T07:00:00Z',
  windowStart: '2026-10-22',
  windowEnd: '2026-11-18',
};
const LINK = 'https://circles.test/j/abcdefgh';
const QUESTION = /^How did you hear about/;

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function share(answer: 'answered' | 'later' = 'answered', tagged = false) {
  return wrap(<PlanSharedFlow id={CIRCLE} planId={PLAN} first={{ answer, tagged }} />);
}

beforeEach(() => {
  for (const mock of [push, replace, track, planToShare, shareMessage, copyText, askToShow]) {
    mock.mockReset();
  }
  recordAnswer.mockReset();
  planToShare.mockResolvedValue(PLAN_TO_SHARE);
  shareMessage.mockResolvedValue('sheet');
  copyText.mockResolvedValue(true);
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
  forgetSessionNudges();
});

describe("the first run's share", () => {
  it('is the bubble with the real link, one line about the replies, and one primary', async () => {
    share();

    expect(await screen.findByText('Ask Sunday Crew.')).toBeVisible();
    // The message the group will get, with the link in it, in one bubble.
    expect(document.body).toHaveTextContent(
      "When can Sunday Crew actually catch up? Pick the times you'd be up for, no app needed: " +
        LINK,
    );
    expect(screen.getByText('To Sunday Crew')).toBeVisible();
    expect(
      screen.getByText("Replies close Sun Oct 25, 6 pm. We'll email you the best times."),
    ).toBeVisible();
    // No intro, no link-preview block, no link row (the bubble is the link), no
    // numbered step, and Add my times only for an organiser who answered later.
    expect(screen.queryByText(/One link in the chat/)).toBeNull();
    expect(screen.queryByText('What lands in the chat')).toBeNull();
    expect(screen.queryByText(/^\d of \d$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add my times' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Share to group chat' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible();
    // The question is not asked before the share.
    expect(askToShow).not.toHaveBeenCalled();
  });

  it('puts a window other than the month in the first sentence', async () => {
    planToShare.mockResolvedValue({
      ...PLAN_TO_SHARE,
      windowStart: '2026-10-22',
      windowEnd: '2026-11-04',
    });
    share();
    expect(await screen.findByText(/actually catch up in the next two weeks\?/)).toBeVisible();
  });

  it('offers Add my times, and only then, when the organiser chose to answer later', async () => {
    share('later');
    await screen.findByText('Ask Sunday Crew.');
    fireEvent.click(screen.getByRole('button', { name: 'Add my times' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: 'abcdefgh' } });
  });

  it('turns into "Over to {group}." when the share sheet closes, with the question as a quiet card', async () => {
    share();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Share to group chat' }));
    });

    expect(shareMessage).toHaveBeenCalledWith(expect.stringContaining(LINK));
    expect(await screen.findByText('Over to Sunday Crew.')).toBeVisible();
    expect(screen.getByText("We'll email you when the best times are in.")).toBeVisible();
    expect(screen.getByText('Go to Sunday Crew', { selector: '*' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share again' })).toBeVisible();
    // Asked only now, after the share, and as a card with its own Skip.
    expect(await screen.findByText(/^How did you hear about/)).toBeVisible();
    expect(screen.getByText('Only counted, never tied to you.')).toBeVisible();
    expect(track).toHaveBeenCalledWith('plan_shared', { circle_id: CIRCLE, plan_id: PLAN });
  });

  it('is done even when the organiser closed the sheet without sending', async () => {
    shareMessage.mockResolvedValue('dismissed');
    share();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Share to group chat' }));
    });
    expect(await screen.findByText('Over to Sunday Crew.')).toBeVisible();
    expect(track).toHaveBeenCalledWith('share_opened', expect.objectContaining({ kind: 'plan' }));
    expect(track).not.toHaveBeenCalledWith('plan_shared', expect.anything());
  });

  it('stays on the share, and says so, when the message could not be handed on', async () => {
    shareMessage.mockResolvedValue('failed');
    share();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Share to group chat' }));
    });
    expect(await screen.findByText(/We couldn't copy it here/)).toBeVisible();
    expect(screen.getByText('Ask Sunday Crew.')).toBeVisible();
  });

  it('goes to the circle from Go to {group}, and back to the share from Share again', async () => {
    share();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Share to group chat' }));
    });
    await screen.findByText('Over to Sunday Crew.');

    fireEvent.click(screen.getByRole('button', { name: 'Share again' }));
    expect(await screen.findByText('Ask Sunday Crew.')).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share to group chat' }));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Go to Sunday Crew' }));
    expect(replace).toHaveBeenCalledWith({ pathname: '/circles/[id]', params: { id: CIRCLE } });
  });

  it('copies in place: Copy becomes Copied, and the screen does not move on', async () => {
    share();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    });
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining(LINK));
    expect(await screen.findByText('Copied')).toBeVisible();
    expect(screen.getByText('Ask Sunday Crew.')).toBeVisible();
    expect(track).toHaveBeenCalledWith('plan_shared', { circle_id: CIRCLE, plan_id: PLAN });
  });

  it('answers the source question for a tagged arrival, without asking it', async () => {
    share('answered', true);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Share to group chat' }));
    });
    await screen.findByText('Over to Sunday Crew.');
    await waitFor(() => expect(recordAnswer).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(track).toHaveBeenCalledWith('organiser_source', { source: 'content' });
  });
});
