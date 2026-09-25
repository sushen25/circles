import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { fromISO } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createFirstPlan } from '../../data/planning';
import { failureOf, isOffline } from '../identity/join/failure';
import { bandWords, FIRST_PLAN_PRESETS, firstPlanPreview, type FirstPlanPreset } from './firstPlan';
import { FirstPlanScreen, type FirstPlanProblem } from './FirstPlanScreen';
import { tonightNote, WINDOW_EVENT } from './form';
import { InitiateGateFlow } from '../growth/InitiateGateFlow';
import { PlanInProgress } from './PlanInProgressFlow';
import { closesAtWords, closesIn, presetLabel, tonightNoteWords } from './words';

/**
 * `/circles/:id/plan/new` — the first plan, defaults accepted (spec §5.1): one
 * tap, **Ask the group**, through `create-plan`. Since ADR 0026 this is step 2
 * of 2, straight after the circle is made and before anybody has been invited:
 * the plan's own link is what goes in the group chat.
 *
 * Organising needs a saved place and membership (`RouteKind` `organiser`). The
 * route's gate has already established membership; a guest member saves their
 * place on the organiser gate, drawn in place of the card (ADR 0004, S2-07).
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
      presets={FIRST_PLAN_PRESETS.map((each) => ({
        key: each,
        label: presetLabel(each),
        selected: each === 'next_14_days',
        onPress: () => undefined,
      }))}
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

const REASONS: Record<string, FirstPlanProblem> = {
  too_many_requests: 'too_many_tries',
  // Tonight chosen, and the evening ran out while the card was open.
  too_late_for_tonight: 'too_late',
};

const WINDOW_TITLE: Record<FirstPlanPreset, () => string> = {
  next_14_days: () => t('firstPlan', 'catch_up_next_14_days'),
  this_weekend: () => t('firstPlan', 'catch_up_this_weekend'),
  tonight: () => t('firstPlan', 'catch_up_tonight'),
};

function LiveFirstPlan({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  // As `PlanSetupFlow`: read the circle as a member first, and require a saved
  // place only once it says there is no plan running (ADR 0004, ADR 0033).
  const member = guard({ route: 'guest', session, membership: 'member' });
  const decision = guard({ route: 'organiser', session, membership: 'member' });

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    enabled: member.kind === 'allow',
    staleTime: 0,
  });
  // The server's word that a saved place is needed, when the session had not
  // said so: the gate, as for a guest (S2-07).
  const [mustSave, setMustSave] = useState(false);

  // The moment the card was opened: the preview is of a plan made about now,
  // and reading the clock during a render would make it a different plan each
  // time React draws it.
  const [openedAt] = useState(() => Date.now());
  const [preset, setPreset] = useState<FirstPlanPreset>('next_14_days');
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

  if (member.kind !== 'allow' || home.isPending) {
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
  // One open plan per circle (ADR 0033): the first-run card is a way of
  // making a plan, and a circle already finding a time gets that plan instead.
  if (data.activePlan !== null) {
    return <PlanInProgress id={id} home={data} plan={data.activePlan} onBack={back} />;
  }
  // A guest member saves their place here, in place of the form, and the form
  // follows once they have: the guard answers `allow` (ADR 0004, S2-07).
  if (decision.kind === 'needs_saved_place' || mustSave) {
    return (
      <InitiateGateFlow
        intent="plan"
        circleId={id}
        circleName={data.name}
        onSaved={() => setMustSave(false)}
        onNotNow={back}
      />
    );
  }
  if (decision.kind !== 'allow') return <FirstPlanScreen state="loading" onBack={back} />;
  const input = {
    zone: data.zone,
    defaultDurationMinutes: data.defaultDurationMinutes,
    defaultQuorum: data.defaultQuorum,
    members: data.members.length,
  };
  const opened = fromISO(new Date(openedAt).toISOString());
  const preview = firstPlanPreview(input, opened, preset);
  const band = bandWords(preview.band);
  const offTonight = tonightNote(undefined, preview.durationMinutes, opened, data.zone);

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
        preset,
        idempotencyKey: key.current,
      });
      track('plan_created', {
        circle_id: id as CircleId,
        plan_id: plan.plan_id,
        mode: 'named',
        window: WINDOW_EVENT[preset],
        used_defaults: preset === 'next_14_days',
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
        setMustSave(true);
      } else if (failure.kind === 'reason' && failure.reason === 'plan_in_progress') {
        // Somebody's plan got there first: the circle read again is the screen.
        void home.refetch();
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
      presets={FIRST_PLAN_PRESETS.map((each) => ({
        key: each,
        label: presetLabel(each),
        selected: each === preset,
        disabled: !firstPlanPreview(input, opened, each).available,
        onPress: () => {
          if (busy) return;
          // A different plan is a different request (ADR 0016).
          key.current = undefined;
          setProblem(undefined);
          setPreset(each);
        },
      }))}
      presetNote={offTonight === undefined ? undefined : tonightNoteWords(offTonight)}
      window={WINDOW_TITLE[preset]()}
      band={
        preset === 'tonight'
          ? t('firstPlan', 'tonight_hours', { time: band })
          : preview.band.startMin >= 17 * 60
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
        preview.deadline === undefined
          ? t('firstPlan', 'replies_close_in_3_days')
          : closesIn(preview.deadline, openedAt)
      }
      closesAt={
        preview.deadline === undefined || preview.latestStart === undefined
          ? ''
          : closesAtWords(
              { deadline: preview.deadline, latestStart: preview.latestStart },
              data.zone,
            )
      }
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
