import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ownProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { newestCircleId } from '../../data/circles';
import { FirstCircleFlow } from '../circles/FirstCircleFlow';
import { destinationAfterSignIn } from './afterSignIn';
import { isOffline } from './join/failure';
import { WelcomeScreen } from './WelcomeScreen';

/**
 * `/` — the front door (spec §5.1).
 *
 * Somebody without a saved place — nobody at all, or a guest — is at the first
 * circle: no sign-in before value, for the organiser either (ADR 00YY). A
 * returning organiser's way in is the quiet "Sign in" on that screen. An account
 * that is already signed in is not asked anything: it goes to its circles, to its
 * newest circle, or to Your name if it has never been named
 * (`destinationAfterSignIn`) — unless it came from the website's "Start a plan"
 * (`/start`), when a signed-in organiser goes on to a new circle, with no gate.
 *
 * With no backend this is the fixture journey's first screen.
 */
export function WelcomeFlow() {
  return hasBackend() ? <LiveWelcome /> : <FirstCircleFlow />;
}

function LiveWelcome() {
  const router = useRouter();
  const session = useSession();
  const starting = usePathname() === '/start';
  const signedIn = session.status === 'saved' || session.status === 'app';

  const where = useQuery({
    queryKey: ['after-sign-in', session.userId, starting],
    queryFn: async () => {
      const profile = await ownProfile();
      const hasName = profile?.name !== null && profile?.name !== undefined;
      return destinationAfterSignIn({
        starting,
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

  return <FirstCircleFlow />;
}
