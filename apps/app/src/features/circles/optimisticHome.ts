import type { QueryClient } from '@tanstack/react-query';

import type { CircleHome } from '../../data/circles';

/**
 * Show a change to a circle's settings before the server has answered
 * (manifesto §7.4, SUS-155). When the server refuses, the caller asks it what
 * is true (`invalidateQueries`) rather than restoring a snapshot: settings stay
 * tappable while a save is out, and a snapshot taken before two overlapping
 * saves would put back a value the server has since replaced.
 */
export type HomeChange = Partial<CircleHome> | ((home: CircleHome) => Partial<CircleHome>);

export function showHomeAtOnce(
  queryClient: QueryClient,
  key: readonly unknown[],
  change: HomeChange,
): void {
  queryClient.setQueryData<CircleHome>(key, (home) => {
    if (home === undefined) return home;
    return { ...home, ...(typeof change === 'function' ? change(home) : change) };
  });
}
