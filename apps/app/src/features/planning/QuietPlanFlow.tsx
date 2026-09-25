import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

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
  // The organiser is read from the plan row, so when the view says one has
  // appeared — somebody's tap, or this person's on another device — the row is
  // read again with it, and an organiser reading this is sent to their screens.
  const organiser = view.data?.phase === 'opened' ? view.data.organiser : null;
  const refetchPlan = plan.refetch;
  useEffect(() => {
    if (organiser !== null) void refetchPlan();
  }, [organiser, refetchPlan]);

  // The circle is the plan's: a URL naming another circle is not this plan's
  // page, and drawing one circle's ask in another's name would be a lie.
  const circle = plan.data?.circleId;
  const mismatched = circleId !== undefined && circle !== undefined && circle !== circleId;
  const home = useQuery({
    queryKey: ['circle-home', circle, session.userId],
    queryFn: () => circleHome(circle as string),
    enabled: signedIn && circle !== undefined && !mismatched,
    staleTime: 60_000,
  });

  const toCircle = () =>
    circle === undefined || mismatched
      ? router.replace('/')
      : router.replace({ pathname: '/circles/[id]', params: { id: circle } });
  const back = () => (router.canGoBack() ? router.back() : toCircle());

  if (plan.data === null || mismatched) return <PlanStateScreen state="denied" onBack={back} />;
  if (!signedIn || plan.isPending || view.isPending || (circle !== undefined && home.isPending)) {
    return <PlanStateScreen state="loading" onBack={back} />;
  }
  // The circle's read too: without it the screen would say "3 of 0".
  if (plan.isError || view.isError || home.isError) {
    return (
      <PlanStateScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void plan.refetch();
          void view.refetch();
          void home.refetch();
        }}
        onBack={back}
      />
    );
  }
  if (circle === undefined || home.data === null) {
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
