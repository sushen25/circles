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
 */
export function useSavedPlace(): 'wait' | 'allow' {
  const router = useRouter();
  const session = useSession();
  const decision = guard({ route: 'saved', session });

  useEffect(() => {
    if (decision.kind === 'needs_saved_place') router.replace('/');
  }, [decision.kind, router]);

  return decision.kind === 'allow' ? 'allow' : 'wait';
}
