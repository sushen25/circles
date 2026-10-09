import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/p/:code` starts its five reads together (SUS-174), under the keys the gates
 * read, so the gates find them running instead of making them in turn.
 */

vi.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
let hasBackend = true;
vi.mock('../../data/auth/client', () => ({ hasBackend: () => hasBackend }));
let session: { status: string; userId: string | undefined; isLoading: boolean } = {
  status: 'guest',
  userId: 'nina',
  isLoading: false,
};
vi.mock('../../data/auth', () => ({ useSession: () => session }));
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const reads = {
  planAccess: vi.fn(),
  planByCode: vi.fn(),
  planDetails: vi.fn(),
  planToAnswer: vi.fn(),
  planCandidates: vi.fn(),
};
vi.mock('../../data/membership', () => ({
  planAccess: (...a: unknown[]) => reads.planAccess(...a),
}));
vi.mock('../../data/planning', () => ({
  planByCode: (...a: unknown[]) => reads.planByCode(...a),
  planDetails: (...a: unknown[]) => reads.planDetails(...a),
}));
vi.mock('../../data/availability', () => ({
  planToAnswer: (...a: unknown[]) => reads.planToAnswer(...a),
  readDraft: async () => undefined,
}));
vi.mock('../../data/scheduling', () => ({
  planCandidates: (...a: unknown[]) => reads.planCandidates(...a),
}));

const { usePrefetchPlanPage, planPageKeys } = await import('./usePrefetchPlanPage');
const { usePlanDetails } = await import('./usePlanDetails');
const { useCandidates } = await import('../scheduling/useCandidates');
const { QuietLinkGate } = await import('./QuietLinkGate');
const { PlanLinkFlow } = await import('../availability/PlanLinkFlow');

const CODE = 'pnsundaycr';

function Page({ code }: { code: string }) {
  usePrefetchPlanPage(code);
  return null;
}

/** The gates' own hooks and components, mounted beside the prefetch. */
function Gates({ code }: { code: string }) {
  usePrefetchPlanPage(code);
  usePlanDetails({ code });
  useCandidates({ code });
  return (
    <QuietLinkGate code={code}>
      <PlanLinkFlow code={code}>
        <p>the plan</p>
      </PlanLinkFlow>
    </QuietLinkGate>
  );
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasBackend = true;
  session = { status: 'guest', userId: 'nina', isLoading: false };
  for (const read of Object.values(reads)) read.mockImplementation(() => new Promise(() => {}));
});

describe('the plan page reads', () => {
  it('start together, each once, for a session on a short code', async () => {
    render(
      <QueryClientProvider client={client()}>
        <Page code={CODE} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(reads.planCandidates).toHaveBeenCalledTimes(1));
    for (const read of Object.values(reads)) expect(read).toHaveBeenCalledTimes(1);
    expect(reads.planAccess).toHaveBeenCalledWith(CODE);
    expect(reads.planDetails).toHaveBeenCalledWith({ code: CODE });
    expect(reads.planCandidates).toHaveBeenCalledWith({ code: CODE });
  });

  it('are the ones the gates would make: a gate mounted beside them joins them', async () => {
    reads.planByCode.mockResolvedValue(null);
    reads.planDetails.mockResolvedValue(null);
    reads.planCandidates.mockResolvedValue(null);
    reads.planToAnswer.mockResolvedValue(null);
    render(
      <QueryClientProvider client={client()}>
        <Gates code={CODE} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(reads.planCandidates).toHaveBeenCalledTimes(1));
    // Two observers each of the plan, details and candidates; one request each.
    for (const name of ['planByCode', 'planDetails', 'planToAnswer', 'planCandidates'] as const) {
      expect(reads[name], name).toHaveBeenCalledTimes(1);
    }
    expect(screen.queryByText('the plan')).toBeNull();
  });

  it('use the keys the gates use', () => {
    expect(planPageKeys(CODE as never, 'nina')).toEqual({
      membership: ['membership', 'plan', CODE, 'nina'],
      planByCode: ['plan-by-code', CODE, 'nina'],
      planDetails: ['plan-details', CODE, 'nina'],
      planToAnswer: ['plan-to-answer', CODE, 'nina'],
      planCandidates: ['plan-candidates', CODE, 'nina'],
    });
  });

  it('wait for a session', () => {
    session = { status: 'none', userId: undefined, isLoading: true };
    render(
      <QueryClientProvider client={client()}>
        <Page code={CODE} />
      </QueryClientProvider>,
    );
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });

  it('are not made without a backend, nor for a link that is not a short code', () => {
    hasBackend = false;
    const { unmount } = render(
      <QueryClientProvider client={client()}>
        <Page code={CODE} />
      </QueryClientProvider>,
    );
    unmount();
    hasBackend = true;
    render(
      <QueryClientProvider client={client()}>
        <Page code="NOT A CODE!" />
      </QueryClientProvider>,
    );
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });
});
