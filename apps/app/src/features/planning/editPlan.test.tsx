import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Planning from '../../data/planning';
import { FunctionError } from '../../data/functions';
import * as fixture from './fixtures';

/**
 * EditPlan and ChangeTime against a mocked `revise-plan` (S1-26): the warning
 * is the preview's own list, Save sends the preview's version, and a stale
 * preview is asked again rather than saved over.
 */

// The preview waits for the form to settle (`SETTLE_MS`) before it asks, so a
// full parallel run can take longer than the default second to show it.
configure({ asyncUtilTimeout: 5_000 });

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back, dismissTo: vi.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));

const planDetails = vi.fn();
const previewRevision = vi.fn();
const saveRevision = vi.fn();
vi.mock('../../data/planning', async (original) => ({
  ...(await original<typeof Planning>()),
  planDetails: (...a: unknown[]) => planDetails(...a),
  previewRevision: (...a: unknown[]) => previewRevision(...a),
  saveRevision: (...a: unknown[]) => saveRevision(...a),
}));

const { EditPlanFlow } = await import('./EditPlanFlow');
const { ChangeTimeFlow } = await import('./ChangeTimeFlow');

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const IDS = { circle_id: 'sunday-crew', plan_id: 'thu-17' };
const ASKS_AGAIN = {
  asked_again: ['maya', 'priya', 'tom', 'jess', 'sam'],
  fresh_ask: ['alex'],
  invalidating: ['window'],
  bumps_revision: true,
  version: '1.5',
};

beforeEach(() => {
  vi.clearAllMocks();
  // The fixtures' Tuesday, so the plan's dates are still ahead.
  vi.spyOn(Date, 'now').mockReturnValue(fixture.FIXTURE_NOW);
  planDetails.mockResolvedValue(fixture.asking);
  previewRevision.mockResolvedValue(ASKS_AGAIN);
  saveRevision.mockResolvedValue({ ...ASKS_AGAIN, revision: 2 });
});
afterEach(() => vi.restoreAllMocks());

describe('editing the dates', () => {
  it('shows, before saving, exactly who the preview says will be asked again', async () => {
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));

    expect(
      await screen.findByText(
        'Changing this means you, Priya and 3 others will be asked for their times again, and Alex gets a fresh ask. Anything sent for the old times is cleared.',
      ),
    ).toBeTruthy();
    const [, sent] = previewRevision.mock.calls.at(-1) as [string, Planning.Revision];
    expect(sent).toEqual({
      window: { start: '2026-09-15', end: '2026-09-21' },
      responseDeadline: '2026-09-16T00:00:00.000Z',
    });
    expect(saveRevision).not.toHaveBeenCalled();
  });

  it('saves with the version the preview came back with, then hands over the message', async () => {
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and ask again' }));

    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    const [planId, revision, version] = saveRevision.mock.calls[0] as [
      string,
      Planning.Revision,
      string,
    ];
    expect(planId).toBe('thu-17');
    expect(revision).toEqual(previewRevision.mock.calls.at(-1)?.[1]);
    expect(version).toBe('1.5');
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('plan_edited', { ...IDS, invalidated_responses: true }),
    );
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/shared',
      params: { id: 'sunday-crew', planId: 'thu-17', again: '1' },
    });
  });

  it('asks the preview again when somebody answered in between, and does not save over it', async () => {
    saveRevision.mockRejectedValueOnce(
      new FunctionError(
        {
          error: 'conflict',
          reason: 'preview_is_stale',
          message: 'moved',
          request_id: 'r',
        } as never,
        'stale',
      ),
    );
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and ask again' }));

    expect(
      await screen.findByText(
        'Someone just answered, so who is asked again has changed. Check it, then save again.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(previewRevision.mock.calls.length).toBeGreaterThan(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps Save shut while the refused preview is being asked again', async () => {
    saveRevision.mockRejectedValueOnce(
      new FunctionError(
        {
          error: 'conflict',
          reason: 'preview_is_stale',
          message: 'moved',
          request_id: 'r',
        } as never,
        'stale',
      ),
    );
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    await screen.findByRole('button', { name: 'Save and ask again' });
    // The next preview does not come back until the test says so.
    let answer: (value: unknown) => void = () => undefined;
    previewRevision.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Save and ask again' }));

    expect(await screen.findByText("Checking who'd be asked again")).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    expect(saveRevision).toHaveBeenCalledTimes(1);
    answer({ ...ASKS_AGAIN, version: '1.6' });
    fireEvent.click(await screen.findByRole('button', { name: 'Save and ask again' }));
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(2));
    expect(saveRevision.mock.calls[1]?.[2]).toBe('1.6');
  });

  it('retries a save whose answer was lost with the same key', async () => {
    saveRevision.mockRejectedValueOnce(new FunctionError(undefined, 'no answer'));
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    const save = await screen.findByRole('button', { name: 'Save and ask again' });
    fireEvent.click(save);
    expect(await screen.findByText(/^Something went wrong/)).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(2));
    expect(saveRevision.mock.calls[1]?.[3]).toBe(saveRevision.mock.calls[0]?.[3]);
  });

  it('says a quorum change costs nobody a reply, and goes back when saved', async () => {
    previewRevision.mockResolvedValue({
      ...ASKS_AGAIN,
      asked_again: [],
      fresh_ask: [],
      invalidating: [],
      bumps_revision: false,
    });
    saveRevision.mockResolvedValue({ ...ASKS_AGAIN, bumps_revision: false, revision: 1 });
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click(await screen.findByRole('button', { name: 'One more person' }));

    expect(
      await screen.findByText(
        'Nobody has to answer again: this changes what happens to the answers, not the question.',
      ),
    ).toBeTruthy();
    expect(previewRevision.mock.calls.at(-1)?.[1]).toEqual({ quorum: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(back).toHaveBeenCalled());
    expect(track).toHaveBeenCalledWith('plan_edited', { ...IDS, invalidated_responses: false });
  });

  it("is the organiser's alone, and says so", async () => {
    planDetails.mockResolvedValue({ ...fixture.asking, isOrganiser: false, me: 'priya' });
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    expect(await screen.findByText('Only the organiser can edit this plan.')).toBeTruthy();
    expect(previewRevision).not.toHaveBeenCalled();
  });
});

describe('changing a locked-in time', () => {
  beforeEach(() => planDetails.mockResolvedValue(fixture.lockedIn));

  it('reopens with a new window and a deadline still ahead, and records a reschedule', async () => {
    show(<ChangeTimeFlow id="sunday-crew" planId="thu-17" />);
    expect(
      await screen.findByText(
        'Thursday will be marked as no longer happening, and everyone will be asked for their times again.',
      ),
    ).toBeTruthy();
    const ask = await screen.findByRole('button', { name: 'Ask again' });
    await waitFor(() => expect(ask.getAttribute('aria-disabled')).not.toBe('true'));
    // From the day after Thursday, so Thursday is not on offer again; the
    // fortnight's own 72-hour deadline.
    expect(screen.getByRole('checkbox', { name: /^14 days from / })).toBeTruthy();
    expect(previewRevision.mock.calls.at(-1)?.[1]).toMatchObject({
      reopen: true,
      window: { start: '2026-09-18', end: '2026-10-01' },
      responseDeadline: '2026-09-18T00:00:00.000Z',
    });
    fireEvent.click(ask);
    await waitFor(() => expect(track).toHaveBeenCalledWith('plan_rescheduled', IDS));
    expect(replace).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/shared',
      params: { id: 'sunday-crew', planId: 'thu-17', again: '1' },
    });
  });

  it('is not offered for a plan that is not locked in', async () => {
    planDetails.mockResolvedValue(fixture.asking);
    show(<ChangeTimeFlow id="sunday-crew" planId="thu-17" />);
    expect(await screen.findByText("This plan isn't locked in.")).toBeTruthy();
  });
});

describe('a plan that moves while the form is open', () => {
  it('sends nothing the organiser did not touch, even after a refetch brings a newer plan', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EditPlanFlow id="sunday-crew" planId="thu-17" />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Save changes' });
    // Somebody joins through the link and the defaulted quorum follows (ADR 0026).
    planDetails.mockResolvedValue({ ...fixture.asking, quorum: 5 });
    await client.invalidateQueries({ queryKey: ['plan-details'] });
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(previewRevision).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});

describe('a failed refetch while editing', () => {
  it('keeps the half-edited form rather than swapping it for an error', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EditPlanFlow id="sunday-crew" planId="thu-17" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Next 7 days' }));
    await screen.findByRole('button', { name: 'Save and ask again' });
    planDetails.mockRejectedValue(new Error('offline'));
    await client.invalidateQueries({ queryKey: ['plan-details'] });
    await waitFor(() =>
      expect(client.getQueryState(['plan-details', 'thu-17', 'maya'])?.status).toBe('error'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText("We couldn't load this plan.")).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Next 7 days' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('who has to be there', () => {
  it('offers somebody still required who has left, so they can be taken off', async () => {
    planDetails.mockResolvedValue({
      ...fixture.asking,
      roster: [...fixture.asking.roster, { userId: 'lee', name: 'Lee', active: false }],
      required: ['maya', 'lee'],
    });
    show(<EditPlanFlow id="sunday-crew" planId="thu-17" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Change' }))[0]!);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Lee (left the circle)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(previewRevision.mock.calls.at(-1)?.[1]).toEqual({ requiredMemberIds: ['maya'] }),
    );
  });
});
