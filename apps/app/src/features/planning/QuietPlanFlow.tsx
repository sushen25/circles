import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { quietPlan, quietView } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { quietScreenOf } from './quiet';
import { QuietScreens } from './QuietScreens';
import { PlanStateScreen } from './states';

/**
 * `/circles/:id/quiet/:planId`, and `/p/:code` while a quiet ask has nobody
 * organising it — one flow behind both, because which screen is true is a fact
 * about the ask and changes while it is open (spec §5.4).
 *
 * **Every screen reads `quiet-view` and nothing else about the ask.** The view
 * is built on the server for whoever reads it and carries capabilities, not
 * facts: `quietScreenOf` turns them into SparkWaiting, InterestPrompt,
 * ThresholdRole, Volunteer, SparkOpenedMember or SparkExpired. The plan row
 * read beside it is the public half — its code, its window, its organiser
 * once there is one — and has no initiator to read.
 *
 * While it asks, and while nobody has taken the role, the view is read again
 * every half minute: an ask opens on somebody else's answer, and a role is
 * taken by somebody else's tap.
 */
export function QuietPlanFlow({ planId, circleId }: { planId: string; circleId?: string }) {
  if (!hasBackend()) return <PlanStateScreen state="loading" />;
  return <LiveQuietPlan planId={planId} circleId={circleId} />;
}

const POLL_MS = 30_000;

function LiveQuietPlan({ planId, circleId }: { planId: string; circleId: string | undefined }) {
  const router = useRouter();
  const session = useSession();
  const signedIn = session.userId !== undefined;

  const plan = useQuery({
    queryKey: ['quiet-plan', planId, session.userId],
    queryFn: () => quietPlan(planId),
    enabled: signedIn,
    staleTime: 0,
  });
  const view = useQuery({
    queryKey: ['quiet-view', planId, session.userId],
    queryFn: () => quietView(planId),
    enabled: signedIn,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.phase === 'seeking') return POLL_MS;
      if (data?.phase === 'opened' && data.organiser === null) return POLL_MS;
      return false;
    },
  });
  const circle = circleId ?? plan.data?.circleId;
  const home = useQuery({
    queryKey: ['circle-home', circle, session.userId],
    queryFn: () => circleHome(circle as string),
    enabled: signedIn && circle !== undefined,
    staleTime: 60_000,
  });

  const toCircle = () =>
    circle === undefined
      ? router.replace('/')
      : router.replace({ pathname: '/circles/[id]', params: { id: circle } });
  const back = () => (router.canGoBack() ? router.back() : toCircle());

  if (!signedIn || plan.isPending || view.isPending || (circle !== undefined && home.isPending)) {
    return <PlanStateScreen state="loading" onBack={back} />;
  }
  if (plan.isError || view.isError) {
    return (
      <PlanStateScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void plan.refetch();
          void view.refetch();
        }}
        onBack={back}
      />
    );
  }
  if (plan.data === null || circle === undefined) {
    return <PlanStateScreen state="denied" onBack={back} />;
  }

  return (
    <QuietScreens
      plan={plan.data}
      screen={quietScreenOf(view.data, plan.data, session.userId)}
      circleName={home.data?.name ?? undefined}
      members={home.data?.members ?? []}
      reread={() => Promise.all([view.refetch(), plan.refetch()])}
      onBack={back}
      toCircle={toCircle}
    />
  );
}
