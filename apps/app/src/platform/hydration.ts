import { useSyncExternalStore } from 'react';

/**
 * Whether React owns this page yet (ADR 00XX).
 *
 * The web build's HTML is rendered once, at export, with no visitor in it: no
 * route parameter, no fragment, no session, no locale, no zone, no clock but
 * the build machine's (ADR 0001's `server` output pre-renders every page). So
 * the root layout renders a neutral shell until this is true, and nothing that
 * depends on the visitor is ever in the served HTML.
 *
 * `false` on the server **and during hydration**, because React reads the
 * server snapshot while it hydrates; then `true`, in the re-render React
 * schedules straight after, because the client snapshot differs. On native
 * there is no hydration and the client snapshot is read from the first render,
 * so native never renders the shell at all.
 *
 * Nothing to subscribe to: it changes once, and React does the changing.
 */
const noSubscription = () => () => undefined;
const onTheClient = () => true;
const onTheServer = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, onTheClient, onTheServer);
}
