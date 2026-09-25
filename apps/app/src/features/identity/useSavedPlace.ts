import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { guard } from '../../data/auth/guards';
import { useSession } from '../../data/auth/session';
import { belongsToAnyCircle } from '../../data/circles';

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
 * settings, which the organiser emails link to (ADR 0029). They have an
 * account, so they go straight to sign-in and come back here after it. It must
 * be a path `safeReturnPath` keeps, or sign-in drops it.
 */
export function useSavedPlace(
  options: { returnTo?: string; gateGuests?: boolean } = {},
): 'wait' | 'allow' | 'gate' {
  const router = useRouter();
  const session = useSession();
  const decision = guard({ route: 'saved', session });
  const { returnTo, gateGuests = false } = options;

  // `gateGuests`: a guest who belongs to a circle already is not a stranger to
  // be sent to Welcome, but somebody about to organise with a place to keep —
  // the organiser gate, which links it (S2-07). A guest with no circle has
  // nothing to link, and Welcome is where an organiser starts.
  const guestWithCircles = useQuery({
    queryKey: ['belongs-to-any-circle', session.userId],
    queryFn: belongsToAnyCircle,
    enabled: gateGuests && session.status === 'guest',
    staleTime: 30_000,
  });
  const gated = gateGuests && session.status === 'guest';

  useEffect(() => {
    if (decision.kind !== 'needs_saved_place') return;
    if (gated && guestWithCircles.data !== false && !guestWithCircles.isError) return;
    if (returnTo === undefined) router.replace('/');
    else router.replace({ pathname: '/sign-in', params: { next: returnTo } });
  }, [decision.kind, gated, guestWithCircles.data, guestWithCircles.isError, returnTo, router]);

  if (decision.kind === 'allow') return 'allow';
  if (gated && guestWithCircles.data === true) return 'gate';
  return 'wait';
}
