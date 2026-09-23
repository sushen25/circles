import { useQuery } from '@tanstack/react-query';

import { useSession } from '../auth';
import { circleHome, type CircleHome } from './home';
import { circlesList } from './list';

/**
 * The circle reads as hooks, keyed by who is reading: the same circle reads
 * differently to its owner and to a member, and a sign-out and sign-in in the
 * same tab must not be handed the last person's cache.
 *
 * `circle-home` is the key S1-22's screens already used; keeping it means an
 * invalidation from any of them refreshes all of them.
 */
export const circleKeys = {
  all: ['circle-home'] as const,
  home: (id: string, userId: string | undefined) => ['circle-home', id, userId] as const,
  list: (userId: string | undefined) => ['circles', userId] as const,
  switches: (userId: string | undefined) => ['circle-switches', userId] as const,
};

export function useCircles(options: { enabled?: boolean } = {}) {
  const session = useSession();
  return useQuery({
    queryKey: circleKeys.list(session.userId),
    queryFn: circlesList,
    staleTime: 0,
    refetchOnWindowFocus: true,
    enabled: options.enabled ?? true,
  });
}

export function useCircle(
  id: string,
  options: { poll?: (data: CircleHome | null | undefined) => number | false } = {},
) {
  const session = useSession();
  const { poll } = options;
  return useQuery<CircleHome | null>({
    queryKey: circleKeys.home(id, session.userId),
    queryFn: () => circleHome(id),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (poll === undefined ? false : poll(query.state.data)),
  });
}
