import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { guard } from '../../data/auth/guards';
import { useSession } from '../../data/auth/session';

/**
 * A route that needs a saved place and nothing else — Your name, a first
 * circle (ADR 0004, `RouteKind` `saved`).
 *
 * The answer is `guard()`'s. Somebody without a saved place is sent to Welcome,
 * which is where one is made: on the organiser's path the only way to reach
 * these screens without one is a stale tab or a typed URL, and Welcome is the
 * start of the path, not a wall.
 *
 * `returnTo` is for a screen somebody arrives at from outside — notification
 * settings, which the organiser emails link to (ADR 00XX). They have an
 * account, so they go straight to sign-in and come back here after it. It must
 * be a path `safeReturnPath` keeps, or sign-in drops it.
 */
export function useSavedPlace(options: { returnTo?: string } = {}): 'wait' | 'allow' {
  const router = useRouter();
  const session = useSession();
  const decision = guard({ route: 'saved', session });
  const { returnTo } = options;

  useEffect(() => {
    if (decision.kind !== 'needs_saved_place') return;
    if (returnTo === undefined) router.replace('/');
    else router.replace({ pathname: '/sign-in', params: { next: returnTo } });
  }, [decision.kind, returnTo, router]);

  return decision.kind === 'allow' ? 'allow' : 'wait';
}
