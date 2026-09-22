import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useSession } from '../../data/auth/session';
import { planCandidates, type PlanCandidates } from '../../data/scheduling';

/**
 * The options, kept fresh while the screen is open (spec §5.6, architecture §9.2).
 *
 * People answer from the group chat while the organiser watches, so this reads
 * again every twenty seconds and on every return to the screen. Nothing
 * subscribes to Realtime — a founder decision, and the same one circle home
 * made.
 *
 * Two things shorten the interval rather than a person having to pull:
 *
 * - **A stale set.** The stored set was computed from an older input than the
 *   plan has now, so a recalculation is already on its way; three seconds is
 *   how long the screen waits to see it rather than twenty.
 * - **An answer with no set behind it.** The first reply has landed and the
 *   first calculation has not finished, so there is nothing to be stale: the
 *   waiting screen would otherwise sit on "nobody has answered yet" for up to
 *   twenty seconds after the options existed. A plan with no answers at all is
 *   not this case — there is nothing on its way — and polls at the ordinary
 *   interval.
 */
export const CANDIDATES_POLL_MS = 20_000;

/** While a recalculation is known to be in flight. */
export const STALE_POLL_MS = 3_000;

function intervalFor(data: PlanCandidates | null | undefined): number | false {
  if (data === undefined || data === null) return false;
  if (data.view === 'closed') return false;
  const answeredButUncounted = data.set === null && (data.responded?.length ?? 0) > 0;
  return data.stale || answeredButUncounted ? STALE_POLL_MS : CANDIDATES_POLL_MS;
}

export function useCandidates(
  key: { planId: string } | { code: string },
): UseQueryResult<PlanCandidates | null> {
  const session = useSession();
  const id = 'planId' in key ? key.planId : key.code;

  const query = useQuery({
    queryKey: ['plan-candidates', id, session.userId],
    queryFn: () => planCandidates(key),
    staleTime: 0,
    refetchInterval: (q) => intervalFor(q.state.data),
    refetchOnWindowFocus: true,
  });

  // Coming back to this screen from another in the stack is not a window
  // focus, so TanStack's own refetch does not see it.
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  return query;
}
