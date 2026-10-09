import { ShortCode } from '@circles/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { planToAnswer } from '../../data/availability';
import { planAccess } from '../../data/membership';
import { planByCode, planDetails } from '../../data/planning';
import { planCandidates } from '../../data/scheduling';

/**
 * Starts the five reads `/p/:code` is made of at once (SUS-174).
 *
 * The page is five gates, one inside the next, and each shows a loading state
 * until its own read returns, so the reads ran one after another: about ten
 * round trips before the plan appeared on a phone. They do not depend on each
 * other, only the gates are nested. Started here, in the route, as soon as
 * there is a session, they are all in flight together; each gate then finds its
 * read cached or running under the same key and waits for the one request
 * instead of making it.
 *
 * The gates keep their own logic, and so their own freshness rules. A gate that
 * insists on a read made since it mounted (`isFetchedAfterMount`) still gets
 * one, because a request that lands after it mounted counts, and one that
 * landed before it is read again behind the cached answer. What this changes is
 * what the person waits for, not what any screen decides.
 *
 * The keys are the gates' own. They are spelled out here and not shared with
 * the hooks because those take `{ planId } | { code }` and a key for each shape;
 * `prefetchPlanPage.test.tsx` mounts the real hooks beside this one, so a key
 * that drifts shows up as a second request.
 */
export function planPageKeys(code: ShortCode, userId: string) {
  return {
    membership: ['membership', 'plan', code, userId],
    planByCode: ['plan-by-code', code, userId],
    planDetails: ['plan-details', code, userId],
    planToAnswer: ['plan-to-answer', code, userId],
    planCandidates: ['plan-candidates', code, userId],
  } as const;
}

export function usePrefetchPlanPage(code: string): void {
  const queryClient = useQueryClient();
  const { userId } = useSession();

  useEffect(() => {
    if (!hasBackend() || userId === undefined) return;
    // A link that is not a short code goes to the gate's own "link invalid"
    // screen; it is not worth five requests.
    const parsed = ShortCode.safeParse(code);
    if (!parsed.success) return;
    const key = planPageKeys(parsed.data, userId);
    const short = parsed.data;
    // `prefetchQuery` never throws; a failed read is the gate's to report,
    // when it asks again.
    void queryClient.prefetchQuery({
      queryKey: key.membership,
      queryFn: () => planAccess(short),
      staleTime: 30_000,
    });
    void queryClient.prefetchQuery({ queryKey: key.planByCode, queryFn: () => planByCode(short) });
    void queryClient.prefetchQuery({
      queryKey: key.planDetails,
      queryFn: () => planDetails({ code: short }),
    });
    void queryClient.prefetchQuery({
      queryKey: key.planToAnswer,
      queryFn: () => planToAnswer(short),
    });
    void queryClient.prefetchQuery({
      queryKey: key.planCandidates,
      queryFn: () => planCandidates({ code: short }),
    });
  }, [queryClient, userId, code]);
}
