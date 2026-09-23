import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, type ComponentType } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useCircle, type CircleHome } from '../../data/circles';
import { useFixture } from '../../data/fixtures/useFixture';
import type { Fixture } from '../../data/fixtures';
import { isOffline } from '../identity/join/failure';
import { CircleHomeConfirmedScreen } from './CircleHomeConfirmedScreen';
import { CircleHomeDueScreen } from './CircleHomeDueScreen';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { CircleHomeScreen } from './CircleHomeScreen';
import { EmptyCircleScreen } from './EmptyCircleScreen';
import { HomeInState } from './HomeInState';

/**
 * `/circles/:id` — a circle's home (spec §5.1 step 6, §5.2).
 *
 * Which of its states it shows is the domain's call (`circleHomeState`), from
 * the data: finding a time, locked in, just you, and the cadence's own — about
 * time, never met, no goal, no rush. `HomeInState` draws each.
 *
 * **Fresh while it is on screen.** People join from the group chat while the
 * organiser watches, so the home is read again every fifteen seconds while
 * nothing is asking, and on every return to the screen. Nothing subscribes to
 * Realtime (architecture §9.2).
 */
export function CircleHomeFlow({ id, state }: { id: string; state?: string | undefined }) {
  return hasBackend() ? <LiveHome id={id} /> : <FixtureHome state={state} />;
}

type Common = {
  fixture: Fixture;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
  onSettings?: (() => void) | undefined;
  onShareAgain?: (() => void) | undefined;
  onInviteLink?: (() => void) | undefined;
  onDetails?: (() => void) | undefined;
  onPlanAnother?: (() => void) | undefined;
};

/** Fixture states of this screen (manifesto §7), reached with `?state=`. */
const STATES: Record<string, ComponentType<Common>> = {
  joining: CircleHomeJoiningScreen,
  confirmed: CircleHomeConfirmedScreen,
  due: CircleHomeDueScreen,
  empty: EmptyCircleScreen,
};

function FixtureHome({ state }: { state?: string | undefined }) {
  const router = useRouter();
  const fixture = useFixture();
  const Screen = (state && STATES[state]) || CircleHomeScreen;
  return (
    <Screen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/setup')}
      onSeeHowItsLooking={() => router.push('/circles/sunday-crew/plan/thu-17/candidates')}
      onSettings={() => router.push('/circles/sunday-crew/settings')}
      onShareAgain={() => router.push('/circles/sunday-crew/invite')}
      onInviteLink={() => router.push('/circles/sunday-crew/invite')}
      onDetails={() => router.push('/circles/sunday-crew/plan/thu-17/confirmed')}
      onPlanAnother={() => router.push('/circles/sunday-crew/plan/another')}
      onBack={() => router.back()}
    />
  );
}

/** Fifteen seconds while nothing is asking; nothing while a plan is out. */
export const JOINING_POLL_MS = 15_000;

function pollWhileJoining(data: CircleHome | null | undefined): number | false {
  return data !== undefined && data !== null && data.activePlan === null ? JOINING_POLL_MS : false;
}

function LiveHome({ id }: { id: string }) {
  const router = useRouter();
  const home = useCircle(id, { poll: pollWhileJoining });

  // Back to this screen from another in the stack is not a window focus, so
  // TanStack's own refetch does not see it.
  const { refetch } = home;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles'));

  if (home.isPending) return <CircleHomeJoiningScreen state="loading" onBack={back} />;
  if (home.isError || home.data === null) {
    return (
      <CircleHomeJoiningScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void home.refetch()}
        onBack={back}
      />
    );
  }

  return <HomeInState home={home.data} onBack={back} />;
}
