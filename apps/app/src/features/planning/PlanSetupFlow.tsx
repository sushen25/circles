import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { DURATIONS, fromISO, softQuorum, type DurationMinutes } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { createPlan } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { CustomWindowScreen } from './CustomWindowScreen';
import { FIXTURE_NOW, sundayCrew } from './fixtures';
import { defaultDraft, resolveDraft, WINDOW_EVENT, type PlanDraft } from './form';
import { PlanSetupScreen } from './PlanSetupScreen';
import { refusalOf, type Refused } from './problems';
import { DeadlineSheet, RequiredSheet } from './sheets';
import { usePlanForm, type FormContext, type FormResolved } from './usePlanForm';
import { whenWords } from './when';
import { categoryLabel } from './words';

/**
 * `/circles/:id/plan/setup` — a plan with everything open to change (spec
 * §5.3). FirstPlan's "Change" and circle home's "Plan a catch-up" come here.
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
}: {
  id: string;
  startOn?: 'form' | 'window';
}) {
  return hasBackend() ? (
    <LiveSetup id={id} startOn={startOn} />
  ) : (
    <FixtureSetup startOn={startOn} />
  );
}

function FixtureSetup({ startOn }: { startOn: 'form' | 'window' }) {
  const router = useRouter();
  return (
    <SetupForm
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

function LiveSetup({ id, startOn }: { id: string; startOn: 'form' | 'window' }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const decision = guard({ route: 'organiser', session, membership: 'member' });

  const toSignIn = () =>
    router.replace({ pathname: '/sign-in', params: { next: `/circles/${id}/plan/setup` } });
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
  // The moment the screen was opened: the preview is of a plan made about now,
  // and reading the clock during a render would make it a different plan each
  // time React draws it.
  const [openedAt] = useState(() => Date.now());
  // One key per request: the same form sent again is the same request, and a
  // changed form is a new one (ADR 0016).
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (decision.kind !== 'allow' || home.isPending) {
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
      context={context}
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
        if (refused.needsSavedPlace) toSignIn();
        // A settled refusal is an answer, and the next tap a new request. A
        // dropped response may have made the plan: keep the key, so a retry
        // gets that plan back rather than making a second.
        if (refused.conclusive) key.current = undefined;
      }}
      onBack={back}
    />
  );
}

/** Whether the form means something different now from when it was drawn. */
function movedOn(shown: FormResolved, now: FormResolved, defaultDeadline: boolean): boolean {
  if (!shown.ok || !now.ok) return shown.ok !== now.ok;
  return (
    shown.window.start !== now.window.start ||
    shown.window.end !== now.window.end ||
    shown.band.startMin !== now.band.startMin ||
    shown.band.endMin !== now.band.endMin ||
    // The server counts a default deadline from the moment it makes the plan.
    // The screen keeps up to the minute; anything further has not been shown.
    (defaultDeadline &&
      Math.abs(Date.parse(shown.deadline) - Date.parse(now.deadline)) > TICK_MS + 30_000)
  );
}

/** How often the setup's clock moves on. */
const TICK_MS = 60_000;

function SetupForm({
  context,
  circleDuration,
  now,
  freshNow,
  startOn,
  onAsk,
  onRefused,
  onBack,
}: {
  context: FormContext;
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
  const [clock, setClock] = useState(now);
  // A default deadline is counted from when the plan is made, so the one on
  // screen keeps time with the clock rather than with when the form opened.
  const live = freshNow !== undefined;
  const tick = useRef(freshNow);
  tick.current = freshNow;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setClock(tick.current?.() ?? Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);
  const instant = fromISO(new Date(clock).toISOString());
  const duration = (DURATIONS as readonly number[]).includes(circleDuration)
    ? (circleDuration as DurationMinutes)
    : 120;
  const [initial] = useState(() => defaultDraft({ duration }));
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    startOn,
    resolve: (draft) => resolveDraft(draft, instant, context.zone),
    // "You can pick sooner" while it is the default; once picked, it was.
    closesDetail: (resolved, draft) =>
      draft.deadline === undefined
        ? t('planSetup', 'closes_at_sooner', {
            deadline: whenWords(resolved.deadline, context.zone),
          })
        : whenWords(resolved.deadline, context.zone),
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
      const answer = refusalOf(error);
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
