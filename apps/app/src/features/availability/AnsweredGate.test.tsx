import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * The chat link for somebody who has answered (SUS-250): it opens on how things
 * stand, with "Your times are in." first, and the editor is one tap on.
 */

const redirect = vi.fn();
vi.mock('expo-router', () => ({
  Redirect: (props: unknown) => {
    redirect(props);
    return null;
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'nina', isAnonymous: true, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const planToAnswer = vi.fn();
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
}));

const { AnsweredGate } = await import('./AnsweredGate');
const { writeDraft } = await import('../../data/availability');
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;
const WEDNESDAY = { start: '2099-09-16T09:00:00.000Z', end: '2099-09-16T11:30:00.000Z' };

function open(edit = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnsweredGate code={PLAN.code} edit={edit}>
        <p>the editor</p>
      </AnsweredGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  redirect.mockReset();
  planToAnswer.mockReset();
});
afterEach(cleanup);

describe('the chat link, /j/:code', () => {
  it('opens the options, with the arrival marked, for a guest whose times are in', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open();

    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(redirect.mock.calls[0]?.[0]).toEqual({
      href: { pathname: '/p/[code]', params: { code: PLAN.code, arrived: '1' } },
    });
    expect(screen.queryByText('the editor')).toBeNull();
  });

  it('is the editor for somebody who has not answered', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
    open();

    await screen.findByText('the editor');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('is the editor when Change my times asked for it', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    open(true);

    await screen.findByText('the editor');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('is the editor when a send is still waiting on this phone', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
    await writeDraft('nina', PLAN.code, {
      plan: PLAN,
      windows: [WEDNESDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: globalThis.crypto.randomUUID() as never },
    });
    open();

    await screen.findByText('the editor');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('is the editor, with its own closed screen, once replies have closed', async () => {
    planToAnswer.mockResolvedValue({
      plan: { ...PLAN, acceptingAnswers: false },
      answer: answerable.answer,
    });
    open();

    await screen.findByText('the editor');
    expect(redirect).not.toHaveBeenCalled();
  });
});
