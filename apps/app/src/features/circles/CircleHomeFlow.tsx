import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, type ComponentType } from 'react';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome, type CircleHome } from '../../data/circles';
import { useFixture } from '../../data/fixtures/useFixture';
import type { Fixture } from '../../data/fixtures';
import { t } from '../../copy';
import { isOffline } from '../identity/join/failure';
import { whenWords } from '../planning/when';
import { CircleHomeConfirmedScreen } from './CircleHomeConfirmedScreen';
import { CircleHomeDueScreen } from './CircleHomeDueScreen';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { CircleHomeScreen } from './CircleHomeScreen';
import { EmptyCircleScreen } from './EmptyCircleScreen';
import { homeSubtitle, joiningSubtitle, justJoined, lastCaughtUp, nextOne } from './words';

/**
 * `/circles/:id` — a circle's home (spec §5.1 step 6, §5.2).
 *
 * Two of its states are live here, S1-22's: **filling up** (no plan finding a
 * time yet) and **finding a time** (a named plan collecting answers). The
 * other two, locked in and about time, are later tickets'; until they land a
 * circle in either shows the filling-up home, which is true of it — the
 * members, when they last met, and a way to plan — rather than a fixture.
 *
 * **Fresh while it is on screen.** People join from the group chat while the
 * organiser watches, so the home is read again every fifteen seconds while it
 * is filling up, and on every return to the screen. Nothing subscribes to
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
      onBack={() => router.back()}
    />
  );
}

/** Fifteen seconds while the circle is filling up; nothing while a plan is out. */
export const JOINING_POLL_MS = 15_000;

function pollWhileJoining(data: CircleHome | null | undefined): number | false {
  return data !== undefined && data !== null && data.activePlan === null ? JOINING_POLL_MS : false;
}

function LiveHome({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    staleTime: 0,
    refetchInterval: (query) => pollWhileJoining(query.state.data),
    refetchOnWindowFocus: true,
  });

  // Back to this screen from another in the stack is not a window focus, so
  // TanStack's own refetch does not see it.
  const { refetch } = home;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles'));
  const invite = () => router.push({ pathname: '/circles/[id]/invite', params: { id } });

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

  const data = home.data;
  const members = data.members.map((m) => ({ name: m.name }));

  if (data.activePlan === null) {
    return (
      <CircleHomeJoiningScreen
        circleName={data.name}
        subtitle={joiningSubtitle(data)}
        members={members}
        joined={justJoined(data.members, data.me)}
        lastCaughtUp={lastCaughtUp(data)}
        nextOne={nextOne(data)}
        firstPlan={data.lastMetAt === null}
        onShareAgain={invite}
        onNext={() => router.push({ pathname: '/circles/[id]/plan/new', params: { id } })}
        onBack={back}
      />
    );
  }

  const plan = data.activePlan;
  return (
    <CircleHomeScreen
      circleName={data.name}
      subtitle={homeSubtitle(data)}
      planTitle={plan.title}
      closes={t('circleHome', 'replies_close', {
        deadline: whenWords(plan.responseDeadline, data.zone),
      })}
      replied={t('circleHome', 'replied', { count: plan.replied, total: plan.asked })}
      members={members}
      memberCount={
        data.members.length === 1
          ? t('circleHome', 'one_member_count')
          : t('circleHome', 'member_count', { count: data.members.length })
      }
      lastCaughtUp={lastCaughtUp(data)}
      nextOne={nextOne(data)}
      onInviteLink={invite}
      onSeeHowItsLooking={() =>
        router.push({
          pathname: '/circles/[id]/plan/[planId]/candidates',
          params: { id, planId: plan.id },
        })
      }
      onNext={() => router.push({ pathname: '/circles/[id]/plan/setup', params: { id } })}
      onBack={back}
    />
  );
}
