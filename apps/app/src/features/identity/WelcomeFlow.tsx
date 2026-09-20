import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ownProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { newestCircleId } from '../../data/circles';
import { destinationAfterSignIn } from './afterSignIn';
import { isOffline } from './join/failure';
import { WelcomeScreen } from './WelcomeScreen';

/**
 * `/` — the front door (spec §5.1 step 1).
 *
 * Somebody without a saved place — nobody at all, or a guest — sees Welcome and
 * one way in, by email. An account that is already signed in is not asked to
 * sign in again: it goes to its circles, to its first circle, or to Your name
 * if it has never been named (`destinationAfterSignIn`).
 *
 * With no backend this is the fixture journey's first screen, unchanged.
 */
export function WelcomeFlow() {
  const router = useRouter();
  const common = {
    onContinueWithEmail: () => router.push('/sign-in'),
    onTerms: () => router.push('/terms'),
    onPrivacy: () => router.push('/privacy'),
  };

  if (!hasBackend()) return <WelcomeScreen {...common} onNext={() => router.push('/circles')} />;
  return <LiveWelcome {...common} />;
}

type Common = {
  onContinueWithEmail: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
};

function LiveWelcome(common: Common) {
  const router = useRouter();
  const session = useSession();
  const signedIn = session.status === 'saved' || session.status === 'app';

  const where = useQuery({
    queryKey: ['after-sign-in', session.userId],
    queryFn: async () => {
      const profile = await ownProfile();
      const hasName = profile?.name !== null && profile?.name !== undefined;
      return destinationAfterSignIn({
        hasName,
        circleId: hasName ? await newestCircleId() : undefined,
      });
    },
    // Asked on focus, below, and never answered from the cache: the answer
    // changes while Welcome waits underneath — a name saved, a circle made —
    // and a stale "/name" sent somebody coming Back from FirstCircle to Your
    // name again (review round 4).
    enabled: false,
  });

  /**
   * Only while Welcome is the screen in front. It stays mounted under
   * `/sign-in` in the stack, and an effect that fired on the session changing
   * would navigate from underneath the sign-in that changed it — replacing the
   * Your name screen the person had just been sent to with a second, empty one.
   */
  const { refetch } = where;
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      let current = true;
      void refetch().then((result) => {
        if (current && result.data !== undefined) router.replace(result.data);
      });
      return () => {
        current = false;
      };
    }, [signedIn, refetch, router]),
  );

  if (session.isLoading) return <WelcomeScreen state="loading" />;
  if (signedIn) {
    if (where.isError) {
      return (
        <WelcomeScreen
          state={isOffline() ? 'offline' : 'error'}
          onRetry={() =>
            void refetch().then((result) => {
              if (result.data !== undefined) router.replace(result.data);
            })
          }
        />
      );
    }
    return <WelcomeScreen state="loading" />;
  }

  return <WelcomeScreen {...common} />;
}
