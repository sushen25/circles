import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Scheduling from '../../data/scheduling';
import { FunctionError } from '../../data/functions';

/**
 * Replies closed with no decision (S2-05): the organiser's screen with its
 * three ways out, driven through `CandidatesFlow` the way the product reaches
 * it — the read says replies have closed, on the database's clock, and the
 * flow hands over.
 */

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    dismissTo: vi.fn(),
    back: vi.fn(),
    canGoBack: () => true,
  }),
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
const extendDeadline = vi.fn();
const handOffCandidates = vi.fn();
const handOffOrganiser = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
  extendDeadline: (...a: unknown[]) => extendDeadline(...a),
  handOffCandidates: (...a: unknown[]) => handOffCandidates(...a),
  handOffOrganiser: (...a: unknown[]) => handOffOrganiser(...a),
}));
vi.mock('../../platform/share', () => ({ shareMessage: vi.fn(), copyText: vi.fn() }));

const { CandidatesFlow } = await import('./CandidatesFlow');
const fixture = await import('./fixtures');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const organiser = () => <CandidatesFlow id="sunday-crew" planId="thu-17" which="candidates" />;

beforeEach(() => {
  vi.clearAllMocks();
  // Two hours after Tuesday's deadline, in Sunday Crew's week.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));
  planCandidates.mockResolvedValue(fixture.deadlinePassed);
  handOffCandidates.mockResolvedValue([
    { userId: 'priya', name: 'Priya', hasSavedPlace: true },
    { userId: 'sam', name: 'Sam', hasSavedPlace: false },
  ]);
});

afterEach(() => vi.useRealTimers());

describe('the replies-closed screen', () => {
  it('says replies have closed and what still works, with lock-in as the one primary', async () => {
    show(organiser());

    expect(
      await screen.findByText('Replies have closed. Thursday still works for five.'),
    ).toBeTruthy();
    expect(screen.getByText('Replies closed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lock in Thursday' }));

    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/review',
      params: { id: 'sunday-crew', planId: 'thu-17', candidate: '2026-09-17T08:30:00.000Z' },
    });
    expect(track).toHaveBeenCalledWith('deadline_passed_action', {
      circle_id: 'sunday-crew',
      plan_id: 'thu-17',
      action: 'confirm_anyway',
    });
  });

  it('is not the options screen: no nudge, and nobody is asked to wait', async () => {
    show(organiser());
    await screen.findByText('Replies have closed. Thursday still works for five.');

    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();
  });
});

describe('give it one more day', () => {
  it('says until when, and asks the server for exactly that', async () => {
    extendDeadline.mockResolvedValue({ response_deadline: '2026-09-16T10:00:00.000Z' });
    show(organiser());

    const row = await screen.findByRole('button', {
      name: /^Give it one more day\. Reopens replies until /,
    });
    fireEvent.click(row);

    await waitFor(() => expect(extendDeadline).toHaveBeenCalledWith('thu-17'));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('deadline_passed_action', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        action: 'extend',
      }),
    );
  });

  it('is shown, not offered, once this revision has had its day', async () => {
    planCandidates.mockResolvedValue({ ...fixture.deadlinePassed, extendedThisRevision: true });
    show(organiser());

    const row = await screen.findByRole('button', {
      name: 'Give it one more day. It has had its extra day already.',
    });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    expect(extendDeadline).not.toHaveBeenCalled();
  });

  it('says so when there is no time left before the last possible start (ADR 0010)', async () => {
    vi.setSystemTime(new Date('2026-09-20T10:10:00.000Z'));
    show(organiser());

    const row = await screen.findByRole('button', {
      name: 'Give it one more day. Too close to the last possible start to reopen replies.',
    });
    expect(row.getAttribute('aria-disabled')).toBe('true');
  });

  it('puts a refusal in front of the organiser, in words', async () => {
    extendDeadline.mockRejectedValue(
      new FunctionError(
        { error: 'conflict', reason: 'already_extended', message: 'x', reference: 'r' as never },
        'x',
      ),
    );
    show(organiser());

    fireEvent.click(await screen.findByRole('button', { name: /^Give it one more day\./ }));

    expect(await screen.findByText('It has had its extra day already.')).toBeTruthy();
  });
});

describe('hand this to someone else', () => {
  it('lists the circle, greys a guest with why, and hands it to the one chosen', async () => {
    handOffOrganiser.mockResolvedValue(undefined);
    show(organiser());

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Hand this to someone else. Another member picks the time',
      }),
    );
    const sam = await screen.findByRole('button', { name: 'Sam. Needs a saved place' });
    expect(sam.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(sam);
    expect(screen.queryByText('Hand it to Sam?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Priya' }));
    expect(await screen.findByText('Hand it to Priya?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hand it to Priya' }));

    await waitFor(() => expect(handOffOrganiser).toHaveBeenCalledWith('thu-17', 'priya'));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('deadline_passed_action', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        action: 'hand_off',
      }),
    );
  });

  it('says so when the server refuses a guest', async () => {
    handOffOrganiser.mockRejectedValue(
      new FunctionError(
        {
          error: 'forbidden',
          reason: 'requires_saved_place',
          message: 'x',
          reference: 'r' as never,
        },
        'x',
      ),
    );
    show(organiser());

    fireEvent.click(await screen.findByRole('button', { name: /^Hand this to someone else/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Priya' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hand it to Priya' }));

    expect(
      await screen.findByText('They need a saved place before they can organise.'),
    ).toBeTruthy();
  });

  it('says so when nobody else can organise yet', async () => {
    handOffCandidates.mockResolvedValue([{ userId: 'sam', name: 'Sam', hasSavedPlace: false }]);
    show(organiser());

    fireEvent.click(await screen.findByRole('button', { name: /^Hand this to someone else/ }));

    expect(
      await screen.findByText(
        'Nobody else in the circle can organise yet: they need a saved place first.',
      ),
    ).toBeTruthy();
  });
});
