import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tap } from '../../test/tap';

/**
 * "How did you hear about {brand}?" (SUS-171) comes after the share (SUS-247,
 * ADR 0084's amendment, ADR 0090): a quiet card under "Over to {group}.", once
 * the share sheet has closed. Optional, one tap and Skip (ADR 0061), once per
 * account, answered for a tagged arrival (SUS-240), and nothing waits on it.
 */

const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
const session = { status: 'saved', userId: 'maya' as string | undefined, isLoading: false };
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { brand } = await import('@circles/config');
const { SourceCard } = await import('../identity/SourceCard');
const { forgetSessionNudges } = await import('../growth/useNudge');

const QUESTION = `How did you hear about ${brand.name}?`;

const asked = () => askToShow.mock.calls.map(([target]) => target);
const sourceEvents = () => track.mock.calls.filter(([name]) => name === 'organiser_source');

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function card(props: { tagged?: boolean; enabled?: boolean } = {}): ReactNode {
  return (
    <QueryClientProvider client={client}>
      <SourceCard tagged={props.tagged ?? false} enabled={props.enabled ?? true} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  client.clear();
  Object.assign(session, { status: 'saved', userId: 'maya', isLoading: false });
  for (const mock of [track, askToShow, recordAnswer]) mock.mockReset();
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
  forgetSessionNudges();
});

describe('"How did you hear about {brand}?" after the share', () => {
  it('is not drawn, and not even asked about, until the share sheet has closed', async () => {
    const view = render(card({ enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(askToShow).not.toHaveBeenCalled();

    view.rerender(card({ enabled: true }));
    expect(await screen.findByText(QUESTION)).toBeVisible();
    expect(asked()).toEqual([{ moment: 'organiser_source', planId: undefined }]);
  });

  it('is a quiet card: four one-tap answers, Skip, and nothing to type', async () => {
    render(card());
    expect(await screen.findByText(QUESTION)).toBeVisible();
    expect(screen.getByText('Only counted, never tied to you.')).toBeVisible();
    for (const name of ["A friend's group", 'Reddit', 'A meetup or club', 'Somewhere else']) {
      expect(screen.getByRole('checkbox', { name })).toBeVisible();
    }
    expect(screen.getByRole('button', { name: 'Skip' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('records one tap on an answer, and goes away', async () => {
    render(card());
    await tap(screen.findByRole('checkbox', { name: 'Reddit' }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    expect(sourceEvents()).toEqual([['organiser_source', { source: 'reddit' }]]);
    // The account's own record says it was answered, the same for every choice.
    expect(recordAnswer).toHaveBeenCalledTimes(1);
    expect(recordAnswer.mock.calls[0]?.[0]).toEqual({
      moment: 'organiser_source',
      planId: undefined,
    });
    expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
  });

  it('records a skip as skipped', async () => {
    render(card());
    await tap(screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    expect(sourceEvents()).toEqual([['organiser_source', { source: 'skipped' }]]);
    expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
  });

  it('counts a choice once, whatever else is tapped', async () => {
    render(card());
    const meetup = await screen.findByRole('checkbox', { name: 'A meetup or club' });
    // Two taps before the card has gone: one answer.
    fireEvent.click(meetup);
    fireEvent.click(meetup);
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    expect(sourceEvents()).toHaveLength(1);
  });

  it('is not drawn for an account that was asked before, and counts nothing', async () => {
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    render(card());
    await waitFor(() => expect(askToShow).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(sourceEvents()).toEqual([]);
  });

  it('is not drawn, and nothing waits, when the server cannot be asked', async () => {
    askToShow.mockRejectedValue(new Error('offline'));
    render(card());
    await waitFor(() => expect(askToShow).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(sourceEvents()).toEqual([]);
  });

  it('leaves it unanswered, and nothing treated as a value, when the person walks away at the card', async () => {
    render(card());
    expect(await screen.findByText(QUESTION)).toBeVisible();
    cleanup();
    expect(sourceEvents()).toEqual([]);
    expect(recordAnswer).not.toHaveBeenCalled();
  });

  describe('arriving on a tagged link (SUS-240)', () => {
    it('is not asked: the post is the answer, recorded as content, and counts as asked', async () => {
      render(card({ tagged: true }));
      await waitFor(() => expect(recordAnswer).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(sourceEvents()).toEqual([['organiser_source', { source: 'content' }]]);
      expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
    });

    it('records it once, however often the share is shown again', async () => {
      const view = render(card({ tagged: true }));
      await waitFor(() => expect(recordAnswer).toHaveBeenCalledTimes(1));
      view.rerender(card({ tagged: true }));
      view.rerender(card({ tagged: true, enabled: false }));
      view.rerender(card({ tagged: true }));
      expect(sourceEvents()).toHaveLength(1);
    });

    it('records nothing for an account that was asked before, tag or not', async () => {
      askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
      render(card({ tagged: true }));
      await waitFor(() => expect(askToShow).toHaveBeenCalled());
      expect(sourceEvents()).toEqual([]);
      expect(recordAnswer).not.toHaveBeenCalled();
    });

    it('records nothing before the share sheet has closed', async () => {
      render(card({ tagged: true, enabled: false }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(askToShow).not.toHaveBeenCalled();
      expect(sourceEvents()).toEqual([]);
    });
  });
});
