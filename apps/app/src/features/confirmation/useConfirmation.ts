import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useSession } from '../../data/auth/session';
import { planConfirmation, type PlanConfirmation } from '../../data/confirmation';

/**
 * The confirmed meetup, kept fresh while the screen is open (spec §5.7).
 *
 * People correct "going" from the group chat while the organiser looks at the
 * count, so this reads again every thirty seconds and on every return to the
 * screen — no Realtime, the founder's decision for every screen so far.
 */
export const CONFIRMATION_POLL_MS = 30_000;

export function useConfirmation(
  key: { planId: string } | { code: string },
): UseQueryResult<PlanConfirmation | null> {
  const session = useSession();
  const id = 'planId' in key ? key.planId : key.code;

  const query = useQuery({
    queryKey: ['plan-confirmation', id, session.userId],
    queryFn: () => planConfirmation(key),
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.view === 'confirmed' ? CONFIRMATION_POLL_MS : false),
    refetchOnWindowFocus: true,
  });

  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  return query;
}
