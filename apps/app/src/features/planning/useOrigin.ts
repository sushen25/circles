import { useSyncExternalStore } from 'react';

import { appOrigin } from '../../data/links/origin';

const never = () => () => undefined;

/**
 * Where links point — the page's own origin, which a static export does not
 * have while it is rendered on the server. `appOrigin` throws there, so the
 * server renders no message and the client fills it in after hydration, the
 * way the confirmed screen does (S1-28).
 */
export function useOrigin(): string | undefined {
  return useSyncExternalStore(never, appOrigin, () => undefined);
}
