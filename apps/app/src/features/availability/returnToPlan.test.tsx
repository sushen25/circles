import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AvailabilityData from '../../data/availability';

/**
 * An answer sent from the organiser's options goes back to them, with the
 * options read again (SUS-158); every other answer still ends on the sent screen.
 */

const replace = vi.fn();
const push = vi.fn();
const dismissTo = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push, dismissTo, back: vi.fn(), canGoBack: () => false }),
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'saved', userId: 'nina', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const planToAnswer = vi.fn();
const submitAnswer = vi.fn();
vi.mock('../../data/availability', async (original) => ({
  ...(await original<typeof AvailabilityData>()),
  planToAnswer: (...a: unknown[]) => planToAnswer(...a),
  submitAnswer: (...a: unknown[]) => submitAnswer(...a),
  othersSaid: async () => undefined,
  usualTimes: async () => [],
}));

const { AvailabilityFlow } = await import('./AvailabilityFlow');
const { returnToOf } = await import('./useSendAnswer');
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;

function open(returnTo?: 'plan'): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AvailabilityFlow code={PLAN.code} step="times" returnTo={returnTo} />
    </QueryClientProvider>,
  );
  return client;
}

async function sendStored() {
  await screen.findByRole('button', { name: 'Send my times' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send my times' }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
  submitAnswer.mockResolvedValue({ response_id: 'r', revision: 1 });
});

describe('where a sent answer goes', () => {
  it('is back on the options for an organiser who came from them, which are read again', async () => {
    const client = open('plan');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await sendStored();

    expect(submitAnswer).toHaveBeenCalled();
    expect(dismissTo).toHaveBeenCalledWith({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: PLAN.circleId, planId: PLAN.id },
    });
    expect(replace).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['plan-candidates'] });
  });

  it('is the sent screen for everybody else', async () => {
    open();
    await sendStored();
    expect(replace).toHaveBeenCalledWith({
      pathname: '/j/[code]/sent',
      params: { code: PLAN.code },
    });
    expect(dismissTo).not.toHaveBeenCalled();
  });

  it('takes only the one value a link may name', () => {
    expect(returnToOf('plan')).toBe('plan');
    expect(returnToOf('elsewhere')).toBeUndefined();
    expect(returnToOf(undefined)).toBeUndefined();
  });
});
