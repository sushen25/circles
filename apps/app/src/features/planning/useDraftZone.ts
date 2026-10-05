import { useQuery } from '@tanstack/react-query';

import { deviceTimeZone, guard, ownProfile, useSession } from '../../data/auth';

/**
 * The zone a plan drafted before the circle exists is worked out in (ADR 0053).
 *
 * The circle is made in the profile's zone, so a signed-in organiser's card and
 * setup are worked out in it; the device's only stands in until there is a
 * profile. A profile that cannot be read is an error, not the device's zone:
 * the card would say one thing and the circle be made in another.
 */
export function useDraftZone(): {
  state: 'loading' | 'error' | 'ready';
  zone: string;
  signedIn: boolean;
  retry: () => void;
} {
  const session = useSession();
  const signedIn = guard({ route: 'saved', session }).kind === 'allow';
  const profile = useQuery({
    queryKey: ['own-profile', session.userId],
    queryFn: ownProfile,
    enabled: signedIn,
    staleTime: 60_000,
  });
  const state =
    signedIn && profile.isError
      ? 'error'
      : session.isLoading || (signedIn && profile.isPending)
        ? 'loading'
        : 'ready';
  return {
    state,
    zone: profile.data?.zone ?? deviceTimeZone() ?? 'UTC',
    signedIn,
    retry: () => void profile.refetch(),
  };
}
