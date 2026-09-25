import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { instant, QUIET_PRESETS, quietThreshold, toISO } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome, type CircleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createQuietAsk, lastHappenedPlan, type LastHappenedPlan } from '../../data/planning';
import { InitiateGateFlow } from '../growth/InitiateGateFlow';
import { isOffline } from '../identity/join/failure';
import { clockNow, usePlanClock } from './clock';
import { presetAvailable, tonightNote } from './form';
import { PlanInProgress } from './PlanInProgressFlow';
import { rememberAsked, quietWhen } from './quiet';
import { draftFrom, resolveQuiet, stopLabel, type QuietDraft } from './quietSetup';
import { quietRefusalOf, type QuietRefused } from './quietProblems';
import { SparkSetupScreen } from './SparkSetupScreen';
import { PlanStateScreen } from './states';
import { whenWords } from './when';
import { categoryLabel, presetLabel, problemWords, tonightNoteWords } from './words';

/**
 * `/circles/:id/quiet/new` — SparkSetup, "See if people are keen" (spec §5.4.1).
 *
 * The same questions, in the same order, as every way into making a plan:
 * membership first, then the circle — **a plan already finding a time is that
 * plan** (`PlanInProgress`, ADR 0033), since `create-plan` would refuse the ask
 * with `plan_in_progress` — and a saved place only once a form is next, drawn
 * in place of the form as PlanSetupFlow does (ADR 0004, S2-07).
 *
 * Two statements before the form rather than refusals after it: a circle of
 * one has nobody to ask (`nobody_to_ask`), and a member who has muted quiet
 * asks here would be refused with `quiet_asks_muted`. Both are about the
 * reader, from the reader's own circle read.
 *
 * Filled in from the last meetup that happened, as Plan another is (S2-04):
 * the domain's `planAnotherDefaults` decides what carries.
 */
export function QuietSetupFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveQuietSetup id={id} /> : <FixtureQuietSetup />;
}

function FixtureQuietSetup() {
  const router = useRouter();
  return (
    <SparkSetupScreen
      onNext={() => router.push('/circles/sunday-crew/quiet/waiting')}
      onBack={() => router.back()}
    />
  );
}

function LiveQuietSetup({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const member = guard({ route: 'guest', session, membership: 'member' });
  const decision = guard({ route: 'organiser', session, membership: 'member' });

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    enabled: member.kind === 'allow',
    staleTime: 0,
  });
  const last = useQuery({
    queryKey: ['last-happened-plan', id, session.userId],
    queryFn: () => lastHappenedPlan(id),
    enabled: member.kind === 'allow',
  });
  // As PlanSetupFlow: once met, the gate stays until it says it is finished.
  const [mustSave, setMustSave] = useState(false);
  if (decision.kind === 'needs_saved_place' && !mustSave) setMustSave(true);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (member.kind !== 'allow' || home.isPending || last.isPending) {
    return <SparkSetupScreen state="loading" onBack={back} />;
  }
  if (home.isError || last.isError || home.data === null) {
    return (
      <SparkSetupScreen
        state={isOffline() ? 'offline' : home.isError || last.isError ? 'error' : 'denied'}
        onRetry={() => {
          void home.refetch();
          void last.refetch();
        }}
        onBack={back}
      />
    );
  }

  const data = home.data;
  if (data.activePlan !== null) {
    return <PlanInProgress id={id} home={data} plan={data.activePlan} onBack={back} />;
  }
  if (data.members.length < 2) {
    return (
      <PlanStateScreen
        state="empty"
        title={t('sparkSetup', 'nobody_title', { circle: data.name })}
        body={t('sparkSetup', 'nobody_body')}
        onBack={back}
      />
    );
  }
  if (data.mine?.mutedQuietAsks === true) {
    return (
      <PlanStateScreen
        state="denied"
        title={t('sparkSetup', 'muted_title', { circle: data.name })}
        body={t('sparkSetup', 'muted_body')}
        action={t('sparkSetup', 'muted_action')}
        onAction={() => router.push({ pathname: '/circles/[id]/settings', params: { id } })}
        onBack={back}
      />
    );
  }
  if (mustSave) {
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
  if (decision.kind !== 'allow') return <SparkSetupScreen state="loading" onBack={back} />;

  return (
    <QuietForm
      id={id}
      home={data}
      last={last.data}
      onInProgress={() => void home.refetch()}
      onNeedsSavedPlace={() => setMustSave(true)}
      onBack={back}
    />
  );
}

function QuietForm({
  id,
  home,
  last,
  onInProgress,
  onNeedsSavedPlace,
  onBack,
}: {
  id: string;
  home: CircleHome;
  last: LastHappenedPlan | null;
  onInProgress: () => void;
  onNeedsSavedPlace: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<QuietDraft>(() =>
    draftFrom(last, home.defaultDurationMinutes),
  );
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<QuietRefused | undefined>();
  const [clock, setClock] = usePlanClock(clockNow, true);
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  const zone = home.zone;
  const resolved = resolveQuiet(draft, clock, zone);
  const change = (next: Partial<QuietDraft>) => {
    setRefused(undefined);
    setDraft((current) => ({ ...current, ...next }));
  };

  const ask = async () => {
    if (inFlight.current || !resolved.ok || resolved.chosen === undefined) return;
    // Asked again at the tap: the server resolves the stop time when it makes
    // the ask, so a form left open past it would send one it no longer offers.
    const fresh = clockNow();
    const then = resolveQuiet(draft, fresh, zone);
    if (!then.ok || then.chosen?.option !== resolved.chosen.option) {
      setClock(fresh);
      setRefused({ message: t('sparkSetup', 'moved_on'), conclusive: true });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    const options = {
      circleId: id as CircleId,
      title: categoryLabel(draft.category),
      category: draft.category,
      preset: draft.preset,
      stopTime: resolved.chosen.option,
      daily: draft.band,
      durationMinutes: draft.duration === home.defaultDurationMinutes ? undefined : draft.duration,
    };
    const request = JSON.stringify(options);
    if (key.current?.for !== request) key.current = { for: request, key: newIdempotencyKey() };
    try {
      const plan = await createQuietAsk({ ...options, idempotencyKey: key.current.key });
      rememberAsked(plan.plan_id, home.me);
      // Recorded against nobody (`UNATTRIBUTED_EVENTS`) and about nothing: no
      // plan and no circle either, so the row cannot be joined to anything
      // that knows who asked. Not `plan_created`, which is attributed.
      track('quiet_ask_created', {});
      void queryClient.invalidateQueries({ queryKey: ['circle-home', id] });
      router.replace({
        pathname: '/circles/[id]/quiet/[planId]',
        params: { id, planId: plan.plan_id },
      });
    } catch (error) {
      const answer = quietRefusalOf(error, { circleName: home.name });
      setRefused(answer);
      if (answer.needsSavedPlace) onNeedsSavedPlace();
      if (answer.inProgress) onInProgress();
      // The stop time went while the form was open: show what is offered now.
      if (answer.stale) setClock(clockNow());
      if (answer.conclusive) key.current = undefined;
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  const now = instant(clock);
  const when = QUIET_PRESETS.filter(
    (preset) =>
      preset === draft.preset || presetAvailable(preset, draft.band, draft.duration, now, zone),
  ).map((preset) => ({
    key: preset,
    label: presetLabel(preset),
    selected: preset === draft.preset,
    onPress: () => change({ preset, stop: undefined }),
  }));
  const note = tonightNote(draft.band, draft.duration, now, zone);

  const stops = resolved.ok
    ? resolved.options.map((choice) => ({
        key: choice.option,
        label: stopLabel(choice.option, draft.preset),
        selected: choice.option === resolved.chosen?.option,
        onPress: () => change({ stop: choice.option }),
      }))
    : [];
  const stopLine = !resolved.ok
    ? undefined
    : resolved.chosen === undefined
      ? t('sparkSetup', 'no_stop_time', { when: quietWhen(draft.preset) })
      : t('sparkSetup', 'stops_asking_at', { when: whenWords(toISO(resolved.chosen.at), zone) });

  return (
    <SparkSetupScreen
      lede={t('sparkSetup', 'nobody_sees_who_asked', {
        threshold: quietThreshold(home.members.length),
      })}
      when={when}
      whenNote={note === undefined ? undefined : tonightNoteWords(note)}
      category={draft.category}
      onCategory={(category) => change({ category })}
      stopAsking={stops}
      stopLine={stopLine}
      blocked={!resolved.ok || resolved.chosen === undefined}
      problem={resolved.ok ? refused?.message : problemWords(resolved.problem)}
      reference={refused?.reference}
      busy={busy}
      onNext={() => void ask()}
      onBack={onBack}
    />
  );
}
