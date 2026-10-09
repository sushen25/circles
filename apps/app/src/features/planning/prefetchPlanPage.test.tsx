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

  it('are kept for a member, and dropped for somebody who is not in the plan yet', async () => {
    const keep = (access: unknown) => {
      reads.planAccess.mockResolvedValue(access);
      for (const name of ['planByCode', 'planDetails', 'planToAnswer', 'planCandidates'] as const) {
        reads[name].mockResolvedValue(null);
      }
      const queryClient = client();
      render(
        <QueryClientProvider client={queryClient}>
          <Page code={CODE} />
        </QueryClientProvider>,
      );
      return queryClient;
    };
    const keys = planPageKeys(CODE as never, 'nina');
    const others = [keys.planByCode, keys.planDetails, keys.planToAnswer, keys.planCandidates];

    const member = keep({
      membership: 'member',
      circleId: 'c',
      state: 'asking',
      needsAsking: false,
    });
    await waitFor(() => expect(member.getQueryData(keys.membership)).toBeDefined());
    await waitFor(() => expect(member.getQueryData(keys.planCandidates)).toBeNull());
    for (const key of others) expect(member.getQueryData(key), String(key)).toBeNull();

    // `null` is what RLS gives somebody outside the plan; kept, the gates would
    // read it as the plan not existing for as long as it stays fresh.
    const guest = keep({ membership: 'not_member' });
    await waitFor(() => expect(guest.getQueryData(keys.membership)).toBeDefined());
    // Let the other reads land and the clean-up run, then look.
    await waitFor(() => expect(reads.planCandidates).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const key of others) expect(guest.getQueryData(key), String(key)).toBeUndefined();
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
