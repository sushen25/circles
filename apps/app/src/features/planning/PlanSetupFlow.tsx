import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { DURATIONS, fromISO, softQuorum, type DurationMinutes } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createPlan } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { movedOn, usePlanClock } from './clock';
import { CustomWindowScreen } from './CustomWindowScreen';
import { FIXTURE_NOW, sundayCrew } from './fixtures';
import { defaultDraft, resolveDraft, WINDOW_EVENT, type PlanDraft } from './form';
import { InitiateGateFlow } from '../growth/InitiateGateFlow';
import { PlanInProgress } from './PlanInProgressFlow';
import { PlanSetupScreen } from './PlanSetupScreen';
import { refusalOf, type Refused } from './problems';
import { DeadlineSheet, RequiredSheet } from './sheets';
import { usePlanForm, type FormContext } from './usePlanForm';
import { categoryLabel, closesDetail } from './words';

/**
 * `/circles/:id/plan/setup` — a plan with everything open to change (spec
 * §5.3). FirstPlan's "Change" and circle home's "Plan a catch-up" come here.
 *
 * One open plan per circle (ADR 0033): when the circle read here already has
 * a plan finding a time, the screen is that plan with Edit and Cancel rather
 * than a form, so the second "Ask the group" is never offered — and if two
 * taps race, `create-plan` refuses the loser with `plan_in_progress` and the
 * circle is read again, which draws the same screen.
 *
 * Organising needs a saved place and membership (`RouteKind` `organiser`); the
 * route's gate has established membership, and a guest member is sent to save
 * their place and brought back, as FirstPlan does (ADR 0004).
 *
 * `/circles/:id/plan/window` is the same flow opened on the calendar.
 */
export function PlanSetupFlow({
  id,
  startOn = 'form',
  initial,
  onBack,
}: {
  id: string;
  startOn?: 'form' | 'window';
  /**
   * The form as it opens. Absent, the circle's defaults; Plan another's
   * **Change** passes what it had filled in from last time (S2-04).
   */
  initial?: PlanDraft | undefined;
  /** Where Back goes, when it is not simply back. */
  onBack?: (() => void) | undefined;
}) {
  return hasBackend() ? (
    <LiveSetup id={id} startOn={startOn} initial={initial} onBack={onBack} />
  ) : (
    <FixtureSetup startOn={startOn} initial={initial} />
  );
}

function FixtureSetup({
  startOn,
  initial,
}: {
  startOn: 'form' | 'window';
  initial: PlanDraft | undefined;
}) {
  const router = useRouter();
  return (
    <SetupForm
      initial={initial}
      context={sundayCrew}
      circleDuration={120}
      now={FIXTURE_NOW}
      startOn={startOn}
      onAsk={async () => {
        router.push('/circles/sunday-crew/plan/thu-17/shared');
      }}
      onBack={() => router.back()}
    />
  );
}

function LiveSetup({
  id,
  startOn,
  initial,
  onBack,
}: {
  id: string;
  startOn: 'form' | 'window';
  initial: PlanDraft | undefined;
  onBack: (() => void) | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  // Two questions, in this order. Any member may *see* the circle's plan, and
  // a guest member who taps "Plan a catch-up" while one is running is owed
  // that plan, not an account gate (review round 3): the circle is read as a
  // member, and a saved place is required only once it says there is no plan
  // and a form is what comes next (ADR 0004).
  const member = guard({ route: 'guest', session, membership: 'member' });
  const decision = guard({ route: 'organiser', session, membership: 'member' });

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    enabled: member.kind === 'allow',
    staleTime: 0,
  });
  // The gate, once a guest has met it, stays until it says it is finished —
  // not only until the session is saved. The session flips as soon as the
  // sign-in is through, before `claim-identity` has moved the membership, and
  // the form drawn in that gap reads a circle this identity is not in yet
  // (review round 2). Also the server's word that a saved place is needed,
  // when the session had not said so (S2-07). Adjusted while rendering, so no
  // frame of the form is drawn in between.
  const [mustSave, setMustSave] = useState(false);
  if (decision.kind === 'needs_saved_place' && !mustSave) setMustSave(true);
  // The moment the screen was opened: the preview is of a plan made about now,
  // and reading the clock during a render would make it a different plan each
  // time React draws it.
  const [openedAt] = useState(() => Date.now());
  // One key per request: the same form sent again is the same request, and a
  // changed form is a new one (ADR 0016).
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);

  const back =
    onBack ??
    (() =>
      router.canGoBack()
        ? router.back()
        : router.replace({ pathname: '/circles/[id]', params: { id } }));

  if (member.kind !== 'allow' || home.isPending) {
    return <PlanSetupScreen state="loading" onBack={back} />;
  }
  if (home.isError || home.data === null) {
    return (
      <PlanSetupScreen
        state={isOffline() ? 'offline' : home.isError ? 'error' : 'denied'}
        onRetry={() => void home.refetch()}
        onBack={back}
      />
    );
  }

  const data = home.data;
  if (data.activePlan !== null) {
    return <PlanInProgress id={id} home={data} plan={data.activePlan} onBack={back} />;
  }
  // A guest member saves their place here, in place of the form, and the form
  // follows once they have: the guard answers `allow` (ADR 0004, S2-07).
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
  if (decision.kind !== 'allow') return <PlanSetupScreen state="loading" onBack={back} />;

  const context: FormContext = {
    zone: data.zone,
    people: data.members.map((m) => ({ id: m.userId, name: m.name })),
    me: data.me,
    members: data.members.length,
    quorumShown: data.defaultQuorum ?? softQuorum(data.members.length),
    quorumFollows: data.defaultQuorum === null,
  };

  return (
    <SetupForm
      initial={initial}
      context={context}
      circleName={data.name}
      circleDuration={data.defaultDurationMinutes}
      now={openedAt}
      startOn={startOn}
      freshNow={() => Date.now()}
      onAsk={async (draft, touched) => {
        const options = {
          circleId: id as CircleId,
          title: categoryLabel(draft.category),
          category: draft.category,
          preset: draft.preset,
          custom: draft.preset === 'custom' ? draft.custom : undefined,
          daily: draft.band,
          durationMinutes:
            draft.duration === data.defaultDurationMinutes ? undefined : draft.duration,
          quorum: draft.quorum,
          requiredMemberIds: draft.required,
          responseDeadline: draft.deadline,
        };
        // One tap, one plan: a retry after a timeout returns the plan the first made.
        const request = JSON.stringify(options);
        if (key.current?.for !== request) key.current = { for: request, key: newIdempotencyKey() };
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
      }}
      onRefused={(refused) => {
        if (refused.needsSavedPlace) setMustSave(true);
        // Somebody's plan got there first — another tab, or another member.
        // The circle read again is the screen that shows it.
        if (refused.inProgress) void home.refetch();
        // A settled refusal is an answer, and the next tap a new request. A
        // dropped response may have made the plan: keep the key, so a retry
        // gets that plan back rather than making a second.
        if (refused.conclusive) key.current = undefined;
      }}
      onBack={back}
    />
  );
}

function SetupForm({
  initial: opening,
  context,
  circleName,
  circleDuration,
  now,
  freshNow,
  startOn,
  onAsk,
  onRefused,
  onBack,
}: {
  initial?: PlanDraft | undefined;
  context: FormContext;
  /** For the refusal that names the circle. Absent on fixtures. */
  circleName?: string | undefined;
  circleDuration: number;
  now: number;
  /**
   * The clock at the tap. The server resolves the preset when the plan is
   * made, so a form left open past midnight — or past tonight's last start —
   * would otherwise send a window it no longer shows. Absent on fixtures,
   * whose clock is fixed.
   */
  freshNow?: (() => number) | undefined;
  startOn: 'form' | 'window';
  onAsk: (draft: PlanDraft, touched: boolean) => Promise<void>;
  onRefused?: ((refused: Refused) => void) | undefined;
  onBack: () => void;
}) {
  // A default deadline is counted from when the plan is made, so the one on
  // screen keeps time with the clock rather than with when the form opened.
  const [clock, setClock] = usePlanClock(now, freshNow !== undefined);
  const instant = fromISO(new Date(clock).toISOString());
  const duration = (DURATIONS as readonly number[]).includes(circleDuration)
    ? (circleDuration as DurationMinutes)
    : 120;
  const [initial] = useState(() => opening ?? defaultDraft({ duration }));
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    startOn,
    resolve: (draft) => resolveDraft(draft, instant, context.zone),
    // "You can pick sooner" while it is the default; once picked, it was.
    closesDetail: (resolved, draft) => closesDetail(resolved, draft, context.zone),
  });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>();
  const inFlight = useRef(false);

  if (form.step === 'window') return <CustomWindowScreen {...form.window} />;

  const ask = async () => {
    if (inFlight.current || !form.resolved.ok) return;
    if (freshNow !== undefined) {
      const fresh = freshNow();
      const then = resolveDraft(form.draft, fromISO(new Date(fresh).toISOString()), context.zone);
      if (movedOn(form.resolved, then, form.draft.deadline === undefined)) {
        // Show what would be made now, and let the organiser ask again.
        setClock(fresh);
        setRefused({ message: t('planSetup', 'problem_moved_on'), conclusive: true });
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    try {
      await onAsk(form.draft, form.touched);
    } catch (error) {
      const answer = refusalOf(error, { circleName });
      setRefused(answer);
      onRefused?.(answer);
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <PlanSetupScreen
      category={form.draft.category}
      onCategory={form.setCategory}
      controls={form.controls}
      problem={form.problem}
      refused={refused?.message}
      reference={refused?.reference}
      busy={busy}
      onNext={() => void ask()}
      onBack={onBack}
      sheets={
        <>
          {form.deadlineSheet === undefined ? null : <DeadlineSheet {...form.deadlineSheet} />}
          <RequiredSheet {...form.requiredSheet} />
        </>
      }
    />
  );
}
