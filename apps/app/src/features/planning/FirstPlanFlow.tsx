import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { fromISO } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createFirstPlan } from '../../data/planning';
import { failureOf, isOffline } from '../identity/join/failure';
import { bandWords, firstPlanPreview } from './firstPlan';
import { FirstPlanScreen, type FirstPlanProblem } from './FirstPlanScreen';
import { whenWords } from './when';

/**
 * `/circles/:id/plan/new` — the first plan, defaults accepted (spec §5.1): one
 * tap, **Ask the group**, through `create-plan`. Since ADR 0026 this is step 2
 * of 2, straight after the circle is made and before anybody has been invited:
 * the plan's own link is what goes in the group chat.
 *
 * Organising needs a saved place and membership (`RouteKind` `organiser`). The
 * route's gate has already established membership; a guest member is sent to
 * save their place and brought back (ADR 0004).
 *
 * The request carries a preset and a title and nothing else, so the server
 * resolves the duration, the deadline and — counted again at that moment — the
 * quorum. The card is a preview of exactly those rules.
 */
export function FirstPlanFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveFirstPlan id={id} /> : <FixtureFirstPlan />;
}

function FixtureFirstPlan() {
  const router = useRouter();
  return (
    <FirstPlanScreen
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/shared')}
      onJustInvite={() => router.push('/circles/sunday-crew/invite')}
      onBack={() => router.back()}
    />
  );
}

const DURATION: Record<number, () => string> = {
  60: () => t('firstPlan', 'about_1_hour'),
  90: () => t('firstPlan', 'about_90_minutes'),
  120: () => t('firstPlan', 'about_2_hours'),
  180: () => t('firstPlan', 'about_3_hours'),
  240: () => t('firstPlan', 'about_4_hours'),
  300: () => t('firstPlan', 'about_5_hours'),
};

const REASONS: Record<string, FirstPlanProblem> = { too_many_requests: 'too_many_tries' };

function LiveFirstPlan({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const decision = guard({ route: 'organiser', session, membership: 'member' });

  // A guest member is asked to save their place, on the sign-in that keeps
  // their memberships (`SignInFlow` saves a guest's place), and comes back
  // here. Not the InitiateGate route: that is still fixtures (S2-07), and a
  // real person must not land on a screen whose buttons do nothing (review
  // round 4).
  const toSignIn = () =>
    router.replace({ pathname: '/sign-in', params: { next: `/circles/${id}/plan/new` } });
  useEffect(() => {
    if (decision.kind === 'needs_saved_place') toSignIn();
    // `toSignIn` reads only `id` and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.kind, router, id]);

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    enabled: decision.kind === 'allow',
    staleTime: 0,
  });

  // The moment the card was opened: the preview is of a plan made about now,
  // and reading the clock during a render would make it a different plan each
  // time React draws it.
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FirstPlanProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  // One tap, one plan: a retry after a timeout returns the plan the first made.
  const key = useRef<IdempotencyKey | undefined>(undefined);
  const inFlight = useRef(false);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (decision.kind !== 'allow' || home.isPending) {
    return <FirstPlanScreen state="loading" onBack={back} />;
  }
  if (home.isError || home.data === null) {
    return (
      <FirstPlanScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void home.refetch()}
        onBack={back}
      />
    );
  }

  const data = home.data;
  const preview = firstPlanPreview(
    {
      zone: data.zone,
      defaultDurationMinutes: data.defaultDurationMinutes,
      defaultQuorum: data.defaultQuorum,
      members: data.members.length,
    },
    fromISO(new Date(openedAt).toISOString()),
  );
  const band = bandWords(preview.band);
  const hoursLeft =
    preview.deadline === undefined
      ? undefined
      : Math.round((Date.parse(preview.deadline) - openedAt) / 3_600_000);

  const ask = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    key.current ??= newIdempotencyKey();
    setBusy(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      const plan = await createFirstPlan({
        circleId: id as CircleId,
        title: t('firstPlan', 'plan_title'),
        idempotencyKey: key.current,
      });
      track('plan_created', {
        circle_id: id as CircleId,
        plan_id: plan.plan_id,
        mode: 'named',
        window: 'next_two_weeks',
        used_defaults: true,
      });
      void queryClient.invalidateQueries({ queryKey: ['circle-home', id] });
      router.replace({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id, planId: plan.plan_id },
      });
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'offline') {
        setProblem('offline');
      } else if (failure.kind === 'reason' && failure.reason === 'requires_saved_place') {
        toSignIn();
      } else if (failure.kind === 'reason' && REASONS[failure.reason] !== undefined) {
        setProblem(REASONS[failure.reason]);
      } else {
        setProblem('couldnt_ask');
        setReference(failure.reference);
      }
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <FirstPlanScreen
      circleName={data.name}
      window={t('firstPlan', 'catch_up_next_14_days')}
      band={
        preview.band.startMin >= 17 * 60
          ? t('firstPlan', 'evenings', { time: band })
          : t('firstPlan', 'days', { time: band })
      }
      duration={(DURATION[preview.durationMinutes] ?? DURATION[120]!)()}
      quorum={
        preview.quorum <= preview.members
          ? t('firstPlan', 'at_least_of', { count: preview.quorum, total: preview.members })
          : t('firstPlan', 'at_least', { count: preview.quorum })
      }
      closesIn={
        hoursLeft === undefined
          ? t('firstPlan', 'replies_close_in_3_days')
          : hoursLeft >= 48
            ? t('firstPlan', 'replies_close_in_days', { count: Math.round(hoursLeft / 24) })
            : t('firstPlan', 'replies_close_in_hours', { count: hoursLeft })
      }
      closesAt={preview.deadline === undefined ? '' : whenWords(preview.deadline, data.zone)}
      problem={problem}
      reference={reference}
      busy={busy}
      onChange={() => router.push({ pathname: '/circles/[id]/plan/setup', params: { id } })}
      onSeeIfPeopleAre={() => router.push({ pathname: '/circles/[id]/quiet/new', params: { id } })}
      // Nobody is made to plan (ADR 0026). The invite screen still has the
      // secret this circle was made with, held in memory since `FirstCircle`.
      onJustInvite={() => router.push({ pathname: '/circles/[id]/invite', params: { id } })}
      onNext={() => void ask()}
      onBack={back}
    />
  );
}
