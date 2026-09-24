import { useQuery } from '@tanstack/react-query';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { planDetails } from '../../data/planning';

/**
 * The plan the lifecycle screens read, by id on the organiser's routes and by
 * short code on the member's. Fresh on every mount: these screens decide
 * where to send somebody from the plan's state, and a cached state is the
 * state they were just sent away from.
 */
export function usePlanDetails(key: { planId: string } | { code: string }) {
  const session = useSession();
  const id = 'planId' in key ? key.planId : key.code;
  return useQuery({
    queryKey: ['plan-details', id, session.userId],
    queryFn: () => planDetails(key),
    enabled: hasBackend() && session.userId !== undefined,
    staleTime: 0,
  });
}
