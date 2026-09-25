import { quietThreshold } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { useOrganiserGate } from '../growth/InitiateGateFlow';
import { isOffline } from '../identity/join/failure';
import { ChooseModeScreen } from './ChooseModeScreen';
import { PlanInProgress } from './PlanInProgressFlow';
import { quietStanding } from './quietSetup';
import { PlanStateScreen } from './states';

/**
 * `/circles/:id/plan/mode` — open or quiet (spec §5.3, §5.4). Circle home's
 * **Plan a catch-up** comes here now that there are two ways to start.
 *
 * **See if people are keen** is a door a guest may not go through (ADR 0004):
 * the organiser gate is drawn here, in place of this screen, and the tap they
 * made goes on once their place is saved (`useOrganiserGate`, S2-07). A circle
 * of one is not offered it at all — there is nobody to ask (`nobody_to_ask`).
 * The threshold on the card is this circle's (ADR 0035), not always three.
 * With a plan already finding a time, this is that plan (`PlanInProgress`);
 * and it has its loading, error and offline states rather than drawing a
 * circle of one while the circle is read.
 */
export function ChooseModeFlow({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    enabled: hasBackend(),
    staleTime: 60_000,
  });
  const circleName = home.data?.name ?? undefined;
  const organiser = useOrganiserGate({ circleId: id, circleName });
  const [openedAt] = useState(() => Date.now());

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (organiser.gate !== null) return organiser.gate;

  if (hasBackend()) {
    if (home.isPending) return <PlanStateScreen state="loading" onBack={back} />;
    if (home.isError) {
      return (
        <PlanStateScreen
          state={isOffline() ? 'offline' : 'error'}
          onRetry={() => void home.refetch()}
          onBack={back}
        />
      );
    }
    if (home.data === null) return <PlanStateScreen state="denied" onBack={back} />;
  }
  const data = home.data ?? undefined;
  // A plan finding a time is that plan, on every way into making one (ADR
  // 0033): neither card could be followed, so neither is offered. First,
  // because it is about both cards, not only the quiet one.
  if (data !== undefined && data.activePlan !== null) {
    return <PlanInProgress id={id} home={data} plan={data.activePlan} onBack={back} />;
  }
  // The quiet card: the domain's answer (`canCreateQuietAsk`) from this
  // reader's circle read.
  const standing = data === undefined ? 'allowed' : quietStanding(data, openedAt);
  const members = data?.members.length ?? 6;

  return (
    <ChooseModeScreen
      circleName={hasBackend() ? (circleName ?? '') : undefined}
      quietAsk={standing !== 'nobody_to_ask' && standing !== 'circle_archived'}
      threshold={quietThreshold(Math.max(members, 2))}
      onPlanOpenly={() => router.push({ pathname: '/circles/[id]/plan/setup', params: { id } })}
      onSeeIfKeen={() =>
        organiser.require(() =>
          router.push({ pathname: '/circles/[id]/quiet/new', params: { id } }),
        )
      }
      onBack={back}
    />
  );
}
