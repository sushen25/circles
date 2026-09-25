import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { fromISO, planAnotherDefaults, softQuorum, type PlanCategory } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome, type CircleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createPlan, lastHappenedPlan, type LastHappenedPlan } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { clockNow, movedOn, usePlanClock } from './clock';
import { PRESETS, presetAvailable, resolveDraft, WINDOW_EVENT, type PlanDraft } from './form';
import { PlanAnotherScreen } from './PlanAnotherScreen';
import { PlanInProgress } from './PlanInProgressFlow';
import { PlanSetupFlow } from './PlanSetupFlow';
import { refusalOf, type Refused } from './problems';
import { whenWords } from './when';
import {
  categoryLabel,
  closesIn,
  durationLabel,
  presetLabel,
  problemWords,
  quorumLine,
} from './words';

/**
 * `/circles/:id/plan/another` — the next plan, filled in from the last meetup
 * that happened (spec §5.9, §6.4). Circle home's **Plan another**, and the
 * about-time card's primary, come here.
 *
 * - **A plan already running** is that plan (`PlanInProgress`, ADR 0033), as
 *   on every way into plan setup: a circle has one open plan, and the second
 *   **Ask the group** is never offered.
 * - **Nothing has happened yet** is the ordinary setup: there is no "last
 *   time" to be the same as.
 * - Otherwise, what and when as chips and everything else as one line, "Same
 *   as last time"; **Ask the group** makes the plan in one tap, and **Change**
 *   opens the full setup with all of it filled in.
 *
 * What is carried, and how, is the domain's (`planAnotherDefaults`). Organising
 * needs a saved place, asked for only once it is clear a form is next, as the
 * setup does (ADR 0004).
 */
export function PlanAnotherFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveAnother id={id} /> : <FixtureAnother />;
}

function FixtureAnother() {
  const router = useRouter();
  return (
    <PlanAnotherScreen
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/shared')}
      onChange={() => router.push('/circles/sunday-crew/plan/setup')}
      onSeeIfPeopleAre={() => router.push('/circles/sunday-crew/quiet/new')}
      onBack={() => router.back()}
    />
  );
}

function LiveAnother({ id }: { id: string }) {
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
  const noPlanRunning =
    home.data !== undefined && home.data !== null && home.data.activePlan === null;

  const toSignIn = () =>
    router.replace({ pathname: '/sign-in', params: { next: `/circles/${id}/plan/another` } });
  useEffect(() => {
    if (decision.kind === 'needs_saved_place' && noPlanRunning) toSignIn();
    // `toSignIn` reads only `id` and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.kind, noPlanRunning, router, id]);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (member.kind !== 'allow' || home.isPending || last.isPending) {
    return <PlanAnotherScreen state="loading" onBack={back} />;
  }
  if (home.isError || last.isError || home.data === null) {
    return (
      <PlanAnotherScreen
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
  if (decision.kind !== 'allow') return <PlanAnotherScreen state="loading" onBack={back} />;
  if (last.data === null) return <PlanSetupFlow id={id} />;

  return (
    <AnotherForm
      id={id}
      home={data}
      last={last.data}
      onInProgress={() => void home.refetch()}
      onNeedsSavedPlace={toSignIn}
      onBack={back}
    />
  );
}

function draftFrom(last: LastHappenedPlan): PlanDraft {
  const defaults = planAnotherDefaults(last);
  return {
    category: defaults.category,
    preset: defaults.preset,
    custom: undefined,
    band: defaults.daily,
    duration: defaults.durationMinutes,
    quorum: defaults.quorum,
    required: undefined,
    deadline: undefined,
  };
}

/** "Filled in from September's catch-up", in the circle's zone. */
function monthOf(iso: string, zone: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: zone }).format(
    new Date(iso),
  );
}

function AnotherForm({
  id,
  home,
  last,
  onInProgress,
  onNeedsSavedPlace,
  onBack,
}: {
  id: string;
  home: CircleHome;
  last: LastHappenedPlan;
  onInProgress: () => void;
  onNeedsSavedPlace: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PlanDraft>(() => draftFrom(last));
  const [touched, setTouched] = useState(false);
  const [editing, setEditing] = useState<'form' | 'window' | undefined>();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused | undefined>();
  // The deadline shown is of a plan made about now: the clock moves on every
  // minute rather than being read during a render, and is asked again at the
  // tap, because the server resolves the preset when it makes the plan.
  const [clock, setClock] = usePlanClock(clockNow, true);
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  // Once, when the prefilled plan is first shown: H6's measure is how often
  // this becomes a plan, and how fast.
  useEffect(() => {
    track('plan_another_started', { circle_id: id as CircleId });
  }, [id]);

  if (editing !== undefined) {
    return (
      <PlanSetupFlow
        id={id}
        startOn={editing}
        initial={draft}
        onBack={() => setEditing(undefined)}
      />
    );
  }

  const now = fromISO(new Date(clock).toISOString());
  const resolved = resolveDraft(draft, now, home.zone);
  const change = (next: Partial<PlanDraft>) => {
    setTouched(true);
    setRefused(undefined);
    setDraft((current) => ({ ...current, ...next }));
  };
  const members = home.members.length;
  const quorum = draft.quorum ?? home.defaultQuorum ?? softQuorum(members);

  const ask = async () => {
    if (inFlight.current || !resolved.ok) return;
    // Left open past midnight, or past the window's last start, the form would
    // send a window it no longer shows (review round 1): show what would be
    // made now, and let the organiser ask again.
    const fresh = clockNow();
    const then = resolveDraft(draft, fromISO(new Date(fresh).toISOString()), home.zone);
    if (movedOn(resolved, then, draft.deadline === undefined)) {
      setClock(fresh);
      setRefused({ message: t('planSetup', 'problem_moved_on'), conclusive: true });
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
      daily: draft.band,
      durationMinutes: draft.duration === home.defaultDurationMinutes ? undefined : draft.duration,
      quorum: draft.quorum,
    };
    const request = JSON.stringify(options);
    if (key.current?.for !== request) key.current = { for: request, key: newIdempotencyKey() };
    try {
      const plan = await createPlan({ ...options, idempotencyKey: key.current.key });
      track('plan_created', {
        circle_id: id as CircleId,
        plan_id: plan.plan_id,
        mode: 'named',
        window: WINDOW_EVENT[draft.preset],
        used_defaults: !touched,
      });
      void queryClient.invalidateQueries({ queryKey: ['circle-home', id] });
      router.replace({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id, planId: plan.plan_id },
      });
    } catch (error) {
      const answer = refusalOf(error, { circleName: home.name });
      setRefused(answer);
      if (answer.needsSavedPlace) onNeedsSavedPlace();
      // Somebody's plan got there first: the circle read again is the screen.
      if (answer.inProgress) onInProgress();
      if (answer.conclusive) key.current = undefined;
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  const when = PRESETS.filter(
    (preset) =>
      preset === 'custom' ||
      preset === draft.preset ||
      presetAvailable(preset, draft.band, draft.duration, now, home.zone),
  ).map((preset) => ({
    key: preset,
    label: presetLabel(preset),
    selected: preset === draft.preset,
    // Custom dates are picked on the calendar, which is the full setup's.
    onPress: () =>
      preset === 'custom' ? setEditing('window') : change({ preset, custom: undefined }),
  }));

  return (
    <PlanAnotherScreen
      lede={t('planAnother', 'filled_in_from', { month: monthOf(last.startsAt, home.zone) })}
      category={draft.category}
      onCategory={(category: PlanCategory) => change({ category })}
      when={when}
      summary={t('planAnother', 'summary', {
        duration: durationLabel(draft.duration),
        quorum: quorumLine(quorum, members),
      })}
      closes={resolved.ok ? closesIn(resolved.deadline, clock) : ''}
      closesAt={resolved.ok ? whenWords(resolved.deadline, home.zone) : ''}
      problem={resolved.ok ? refused?.message : problemWords(resolved.problem)}
      reference={refused?.reference}
      busy={busy}
      onChange={() => setEditing('form')}
      onNext={() => void ask()}
      onSeeIfPeopleAre={() => router.push({ pathname: '/circles/[id]/quiet/new', params: { id } })}
      onBack={onBack}
    />
  );
}
