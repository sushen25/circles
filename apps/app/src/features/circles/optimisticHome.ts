import type { QueryClient } from '@tanstack/react-query';

import type { CircleHome } from '../../data/circles';

/**
 * Show a change to a circle's settings before the server has answered, and put
 * it back if the server refuses (manifesto §7.4, SUS-155). The caller says
 * why, in a notice; this only moves the cached home.
 *
 * Settings stay tappable while a save is out, so the way back restores only the
 * fields this change touched. Restoring the whole home would also undo a
 * different save that has landed since.
 */
export type HomeChange = Partial<CircleHome> | ((home: CircleHome) => Partial<CircleHome>);

/** Returns the way back: call it when the server refuses. */
export function showHomeAtOnce(
  queryClient: QueryClient,
  key: readonly unknown[],
  change: HomeChange,
): () => void {
  const before = queryClient.getQueryData<CircleHome>(key);
  if (before === undefined) return () => undefined;
  const patch = typeof change === 'function' ? change(before) : change;
  queryClient.setQueryData<CircleHome>(key, { ...before, ...patch });
  const fields = Object.keys(patch) as (keyof CircleHome)[];
  return () =>
    queryClient.setQueryData<CircleHome>(key, (now) => {
      if (now === undefined) return now;
      const back: Partial<Record<keyof CircleHome, unknown>> = {};
      for (const field of fields) back[field] = before[field];
      return { ...now, ...back } as CircleHome;
    });
}
