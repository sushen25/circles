import { quietThreshold } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { useOrganiserGate } from '../growth/InitiateGateFlow';
import { ChooseModeScreen } from './ChooseModeScreen';

/**
 * `/circles/:id/plan/mode` — open or quiet (spec §5.3, §5.4). Circle home's
 * **Plan a catch-up** comes here now that there are two ways to start.
 *
 * **See if people are keen** is a door a guest may not go through (ADR 0004):
 * the organiser gate is drawn here, in place of this screen, and the tap they
 * made goes on once their place is saved (`useOrganiserGate`, S2-07). A circle
 * of one is not offered it at all — there is nobody to ask (`nobody_to_ask`).
 * The threshold on the card is this circle's (ADR 0035), not always three.
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

  if (organiser.gate !== null) return organiser.gate;

  const members = hasBackend() ? (home.data?.members.length ?? 0) : 6;

  return (
    <ChooseModeScreen
      circleName={hasBackend() ? (circleName ?? '') : undefined}
      quietAsk={members >= 2}
      threshold={quietThreshold(Math.max(members, 2))}
      onPlanOpenly={() => router.push({ pathname: '/circles/[id]/plan/setup', params: { id } })}
      onSeeIfKeen={() =>
        organiser.require(() =>
          router.push({ pathname: '/circles/[id]/quiet/new', params: { id } }),
        )
      }
      onBack={() =>
        router.canGoBack()
          ? router.back()
          : router.replace({ pathname: '/circles/[id]', params: { id } })
      }
    />
  );
}
