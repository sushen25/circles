import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Confirmation from '../../data/confirmation';
import type * as Scheduling from '../../data/scheduling';
import { FunctionError } from '../../data/functions';
import { fixtureStretch } from './fixtureStretch';
import * as confirmationFixture from './fixtures';

/**
 * Editing a locked-in plan (ADR 0050): a new place or note changes nobody and
 * says so; a moved time says who it still works for and who is asked, and is held
 * to the names the organiser saw.
 */

const push = vi.fn();
const replace = vi.fn();
const dismissTo = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push,
    replace,
    dismissTo,
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
const planCandidates = vi.fn();
vi.mock('../../data/scheduling', async (original) => ({
  ...(await original<typeof Scheduling>()),
  planCandidates: (...a: unknown[]) => planCandidates(...a),
}));
const planConfirmation = vi.fn();
const stretchOf = vi.fn();
const editConfirmation = vi.fn();
vi.mock('../../data/confirmation', async (original) => ({
  ...(await original<typeof Confirmation>()),
  planConfirmation: (...a: unknown[]) => planConfirmation(...a),
  stretchOf: (...a: unknown[]) => stretchOf(...a),
  editConfirmation: (...a: unknown[]) => editConfirmation(...a),
}));

const { EditLockedFlow } = await import('./EditLockedFlow');
const scheduling = await import('../scheduling/fixtures');

const SAT = { start: '2026-09-19T09:00:00.000Z', end: '2026-09-19T11:00:00.000Z' };
const PLAN = { ...scheduling.ready, state: 'confirmed' as const, view: 'closed' as const };

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const edit = (start?: string, end?: string) => (
  <EditLockedFlow id="sunday-crew" planId="thu-17" start={start} end={end} />
);
const save = () => screen.getByRole('button', { name: 'Save changes' });

function refusal(reason: string): FunctionError {
  return new FunctionError(
    { error: 'refused', reason, message: 'Refused.', reference: 'REF-1' } as never,
    'Refused.',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  planCandidates.mockResolvedValue(PLAN);
  planConfirmation.mockResolvedValue(confirmationFixture.lockedInOwnTime);
  stretchOf.mockImplementation((_plan: string, startsAt: string, endsAt: string) =>
    Promise.resolve(fixtureStretch(startsAt, endsAt)),
  );
  editConfirmation.mockResolvedValue({
    confirmation_id: 'c2',
    starts_at: SAT.start,
    ends_at: SAT.end,
    going: ['maya', 'tom', 'jess'],
  });
});
afterEach(() => vi.useRealTimers());

describe('changing only the place or the note', () => {
  it('says a new one shows straight away and nobody answers again, and saves nothing until something changed', async () => {
    show(edit());
    expect(await screen.findByText('Edit this plan')).toBeTruthy();
    expect(
      screen.getByText(
        'A new place or note shows for everyone straight away. Nobody has to answer again.',
      ),
    ).toBeTruthy();
    expect(save().getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Where it is'), {
      target: { value: 'Naked for Satan' },
    });
    expect(save().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends no time and no version, and goes back to the confirmed screen', async () => {
    show(edit());
    await screen.findByText('Edit this plan');
    fireEvent.change(screen.getByLabelText('Where it is'), {
      target: { value: 'Naked for Satan' },
    });
    fireEvent.click(save());

    await waitFor(() => expect(editConfirmation).toHaveBeenCalledTimes(1));
    expect(editConfirmation).toHaveBeenCalledWith({
      planId: 'thu-17',
      startsAt: undefined,
      endsAt: undefined,
      expectedInputVersion: undefined,
      placeName: 'Naked for Satan',
      placeUrl: undefined,
      // The note is said whole too: what the screen showed, unchanged.
      note: "Table's booked under my name. Come hungry.",
    });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('confirmation_edited', expect.anything()),
    );
    expect(track).not.toHaveBeenCalledWith('meetup_moved', expect.anything());
    expect(dismissTo).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it('offers to keep it as it is, which leaves without saving', async () => {
    show(edit());
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Friday as it is' }));
    expect(editConfirmation).not.toHaveBeenCalled();
  });
});

describe('moving the time', () => {
  it('says who it still works for and who is asked, before anything is saved', async () => {
    show(edit(SAT.start, SAT.end));
    expect(await screen.findByText(/^You, Tom and Jess can make it · /)).toBeTruthy();
    expect(
      screen.getByText(
        'Everyone sees the new time straight away, with Friday marked as moved. Anyone whose times cover it stays going without doing a thing. Priya, Sam and Alex are asked whether they can come.',
      ),
    ).toBeTruthy();
  });

  it('sends the new time and the version of the names it showed, and tells the catalogue it moved', async () => {
    show(edit(SAT.start, SAT.end));
    await screen.findByText(/^You, Tom and Jess can make it · /);
    await waitFor(() => expect(save().getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(save());

    await waitFor(() => expect(editConfirmation).toHaveBeenCalledTimes(1));
    expect(editConfirmation).toHaveBeenCalledWith({
      planId: 'thu-17',
      startsAt: SAT.start,
      endsAt: SAT.end,
      expectedInputVersion: 5,
      placeName: 'Hope St Radio',
      placeUrl: undefined,
      note: "Table's booked under my name. Come hungry.",
    });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('meetup_moved', {
        circle_id: 'sunday-crew',
        plan_id: 'thu-17',
        attending_count: 3,
        invited_count: 6,
      }),
    );
  });

  it('does not freeze names nobody saw: an answer landing before the tap is noticed and nothing is sent', async () => {
    show(edit(SAT.start, SAT.end));
    await screen.findByText(/^You, Tom and Jess can make it · /);
    await waitFor(() => expect(save().getAttribute('aria-disabled')).not.toBe('true'));
    stretchOf.mockResolvedValue({ ...fixtureStretch(SAT.start, SAT.end), inputVersion: 6 });
    fireEvent.click(save());
    expect(
      await screen.findByText(
        'Someone answered while you were looking, so this is updated. Check who it works for, then save.',
      ),
    ).toBeTruthy();
    expect(editConfirmation).not.toHaveBeenCalled();
  });

  it('says the same when the server finds the names are behind', async () => {
    editConfirmation.mockRejectedValue(refusal('stale_availability'));
    show(edit(SAT.start, SAT.end));
    await screen.findByText(/^You, Tom and Jess can make it · /);
    await waitFor(() => expect(save().getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.click(save());
    expect(
      await screen.findByText(
        'Someone answered while you were looking, so this is updated. Check who it works for, then save.',
      ),
    ).toBeTruthy();
    expect(dismissTo).not.toHaveBeenCalled();
  });

  it('opens the same picker from Change, keeping the time it has', async () => {
    show(edit(SAT.start, SAT.end));
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/set-time',
      params: { id: 'sunday-crew', planId: 'thu-17', mode: 'edit', start: SAT.start, end: SAT.end },
    });
  });
});

describe('the states', () => {
  it('says only the organiser edits a plan to a member', async () => {
    planCandidates.mockResolvedValue({ ...PLAN, ...scheduling.readyAsMember, state: 'confirmed' });
    show(edit());
    expect(await screen.findByText('Only the organiser edits a plan.')).toBeTruthy();
  });

  it('says there is nothing to edit when the plan is not locked in', async () => {
    planConfirmation.mockResolvedValue({
      ...confirmationFixture.lockedInOwnTime,
      view: 'open',
      confirmation: null,
    });
    show(edit());
    expect(await screen.findByText('This plan is not locked in.')).toBeTruthy();
  });

  it('says so when the meetup has finished', async () => {
    editConfirmation.mockRejectedValue(refusal('meetup_has_ended'));
    show(edit());
    await screen.findByText('Edit this plan');
    fireEvent.change(screen.getByLabelText('Where it is'), { target: { value: 'Elsewhere' } });
    fireEvent.click(save());
    expect(
      await screen.findByText('This meetup has finished, so it can no longer be edited.'),
    ).toBeTruthy();
  });

  it('offers to try again when the plan could not be read', async () => {
    planConfirmation.mockRejectedValue(new Error('no'));
    show(edit());
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
