import type { QueryClient } from '@tanstack/react-query';

import type { CircleHome } from '../../data/circles';

/**
 * Show a change to a circle's settings before the server has answered, and put
 * it back if the server refuses (manifesto §7.4, SUS-155). The caller says
 * why, in a notice; this only moves the cached home.
 */
export type HomeChange = Partial<CircleHome> | ((home: CircleHome) => CircleHome);

/** Returns what was there, to hand back to `putHomeBack`. */
export function showHomeAtOnce(
  queryClient: QueryClient,
  key: readonly unknown[],
  change: HomeChange,
): CircleHome | undefined {
  const before = queryClient.getQueryData<CircleHome>(key);
  if (before === undefined) return undefined;
  queryClient.setQueryData<CircleHome>(
    key,
    typeof change === 'function' ? change(before) : { ...before, ...change },
  );
  return before;
}

export function putHomeBack(
  queryClient: QueryClient,
  key: readonly unknown[],
  before: CircleHome | undefined,
): void {
  if (before !== undefined) queryClient.setQueryData<CircleHome>(key, before);
}
