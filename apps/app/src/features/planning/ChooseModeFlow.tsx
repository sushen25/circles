import { flags } from '@circles/config';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { ChooseModeScreen } from './ChooseModeScreen';

/**
 * `/circles/:id/plan/mode` — open or quiet (spec §5.3). Plan openly goes to
 * the setup; the quiet card is S2-03's and stays hidden until `flags.quietAsk`.
 * The circle's name is the only thing read, from the same query circle home
 * already made.
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

  return (
    <ChooseModeScreen
      circleName={hasBackend() ? (home.data?.name ?? '') : undefined}
      quietAsk={flags.quietAsk}
      onPlanOpenly={() => router.push({ pathname: '/circles/[id]/plan/setup', params: { id } })}
      onSeeIfKeen={() => router.push({ pathname: '/circles/[id]/quiet/new', params: { id } })}
      onBack={() =>
        router.canGoBack()
          ? router.back()
          : router.replace({ pathname: '/circles/[id]', params: { id } })
      }
    />
  );
}
