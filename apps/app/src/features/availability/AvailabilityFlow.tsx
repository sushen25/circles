import type { PlanId, ShortCode } from '@circles/contracts';
import {
  ANSWERABLE_STATES,
  cellsToWindows,
  formatMinutesOfDay,
  fromISO,
  localDate,
  rangeText,
  toLocal,
  zone as toZone,
  type LocalDate,
  type ResponseStatus,
  type ShortcutKind,
} from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import {
  clearDraft,
  onChanceToResend,
  planToAnswer,
  readDraft,
  submitAnswer,
  timingOf,
  writeDraft,
  type AnswerablePlan,
  type Draft,
  type OwnAnswer,
} from '../../data/availability';
import { answerable } from '../../data/fixtures';
import { FunctionError, newIdempotencyKey } from '../../data/functions';
import { askToPlan } from '../../data/membership';
import { failureOf, isOffline } from '../identity/join/failure';
import { OfflineScreen } from '../system/OfflineScreen';
import { AvailabilityScreen, type DayView } from './AvailabilityScreen';
import { dateWords, dayRows, deviceTimeFormat, type RowWords } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  paintedDays,
  planShortcuts,
  shortcutOn,
  wholeDayOn,
  windowsOf,
  type EditorState,
} from './editor';
import { NoneWorkScreen, type NoneWorkStatus } from './NoneWorkScreen';

/**
 * Answering a plan: `/j/:code`, and `/j/:code/none` for "none of these dates"
 * (spec §5.5, S1-25).
 *
 * Behind `MembershipGate`, so whoever reaches it is a member; this does not ask
 * again. What it owns:
 *
 * - **Where the answer starts.** A draft on this device for the same question
 *   wins over the stored answer when it is newer, because it is what the person
 *   last did. A draft for an *older* question is discarded and said so — the
 *   organiser changed the plan, and those times were about dates that are no
 *   longer asked (the rescheduled state).
 * - **Keeping it.** Every change is written to the device as it happens, so a
 *   reload, a dead battery or a tunnel costs nothing (§10: edits "survive
 *   refresh").
 * - **Sending it.** One idempotency key per answer, reused by every resend of
 *   that answer and replaced when the answer changes (ADR 0016). No answer from
 *   the server means the times wait on the device and go by themselves when
 *   there is a chance; a refusal means a screen.
 *
 * With no backend configured it renders Sunday Crew's plan from fixtures, so
 * the gallery and the export stay clickable.
 */
export type AvailabilityStep = 'times' | 'none';

export type AvailabilityFlowProps = { code: string; step: AvailabilityStep };

export function AvailabilityFlow({ code, step }: AvailabilityFlowProps) {
  if (!hasBackend()) {
    return (
      <Answering
        code={code}
        step={step}
        plan={answerable.plan}
        answer={answerable.answer}
        draft={undefined}
        changed={false}
        userId={undefined}
        onStale={() => undefined}
      />
    );
  }
  return <LiveAvailability code={code} step={step} />;
}

function LiveAvailability({ code, step }: AvailabilityFlowProps) {
  const router = useRouter();
  const session = useSession();
  const userId = session.userId;
  const queryClient = useQueryClient();

  const question = useQuery({
    queryKey: ['plan-to-answer', code, userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: userId !== undefined,
    staleTime: 30_000,
  });

  // Read on every mount rather than cached: `/j/:code` stays mounted under
  // `/j/:code/none`, and a cached draft would be the one from before the
  // person painted anything.
  const [draft, setDraft] = useState<Draft | undefined | 'reading'>('reading');
  useEffect(() => {
    if (userId === undefined) return;
    let live = true;
    void readDraft(userId, code).then((found) => {
      if (live) setDraft(found);
    });
    return () => {
      live = false;
    };
  }, [userId, code]);

  /** The organiser changed the question while a draft of the old one waited. */
  const [changed, setChanged] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (session.isLoading || userId === undefined || draft === 'reading') {
    return <AvailabilityScreen state="loading" onBack={back} />;
  }

  // The question as the server has it, when it has answered. Until then — or
  // when it cannot answer — the question as this device last saw it, with the
  // person's times: they can finish, and it goes when the connection is back.
  if (question.data === undefined && draft !== undefined) {
    return (
      <Answering
        key={`${draft.plan.id}:${draft.plan.revision}`}
        code={code}
        step={step}
        plan={draft.plan}
        answer={null}
        draft={draft}
        changed={false}
        userId={userId}
        onStale={() => undefined}
      />
    );
  }

  if (question.isError || question.data === null) {
    return (
      <AvailabilityScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void question.refetch()}
        onBack={back}
      />
    );
  }

  if (question.isPending) return <AvailabilityScreen state="loading" onBack={back} />;

  const { plan, answer } = question.data;
  const stale =
    draft !== undefined && (draft.plan.id !== plan.id || draft.plan.revision !== plan.revision);

  return (
    <Answering
      // A new question is a new editor: nothing painted against the old dates
      // may carry over into the new grid.
      key={`${plan.id}:${plan.revision}`}
      code={code}
      step={step}
      plan={plan}
      answer={answer}
      draft={stale ? undefined : draft}
      discardDraft={stale}
      changed={changed || stale}
      userId={userId}
      onStale={() => {
        setChanged(true);
        setDraft(undefined);
        void queryClient.invalidateQueries({ queryKey: ['plan-to-answer', code] });
      }}
    />
  );
}

type Phase =
  | { kind: 'editing'; problem?: string; reference?: string }
  | { kind: 'sending'; status: ResponseStatus }
  | { kind: 'offline'; status: ResponseStatus }
  | { kind: 'error'; status: ResponseStatus; reference: string | undefined }
  | { kind: 'closed' };

type Pending = { status: ResponseStatus; key: ReturnType<typeof newIdempotencyKey>; body: string };

type AnsweringProps = {
  code: string;
  step: AvailabilityStep;
  plan: AnswerablePlan;
  answer: OwnAnswer | null;
  /** A draft for this very question, if the device has one. */
  draft: Draft | undefined;
  /** A draft for an older question is on the device and should go. */
  discardDraft?: boolean;
  changed: boolean;
  /** Undefined with no backend: nothing is stored and nothing is sent. */
  userId: string | undefined;
  onStale: () => void;
};

const SHORTCUT_LABEL: Record<Exclude<ShortcutKind, 'any_time'>, () => string> = {
  after_work: () => t('availability', 'after_work'),
  all_evening: () => t('availability', 'all_evening'),
  morning: () => t('availability', 'morning'),
  afternoon: () => t('availability', 'afternoon'),
};

const WORDS: RowWords = {
  cell: (day, from, to) => t('availability', 'cell', { day, from, to }),
  repeated: (label) => t('availability', 'cell_repeated', { label }),
  get clocksGoBack() {
    return t('availability', 'clocks_go_back');
  },
};

/** Resends while the times are waiting on the device, beyond `online` and focus. */
const RESEND_EVERY_MS = 30_000;

function Answering({
  code,
  step,
  plan,
  answer,
  draft,
  discardDraft = false,
  changed,
  userId,
  onStale,
}: AnsweringProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const timing = useMemo(() => timingOf(plan), [plan]);
  const format = useMemo(() => deviceTimeFormat(), []);
  const rows = useMemo(() => dayRows(timing, format, WORDS), [timing, format]);
  const reducer = useMemo(() => editorReducer(rows, timing), [rows, timing]);

  // Where the answer starts: the device's draft when it is the newer of the
  // two, the stored answer otherwise, and nothing when there is neither.
  const [state, dispatch] = useReducer(reducer, undefined, (): EditorState => {
    const draftWins =
      draft !== undefined &&
      (answer === null || Date.parse(draft.savedAt) > Date.parse(answer.submittedAt));
    if (draftWins) return editorFrom(rows, timing, draft.windows, draft.flexible);
    if (answer !== null) {
      return editorFrom(
        rows,
        timing,
        answer.status === 'windows' ? answer.windows : [],
        answer.status === 'flexible',
      );
    }
    return emptyEditor(rows);
  });

  const usedDraft =
    draft !== undefined &&
    (answer === null || Date.parse(draft.savedAt) > Date.parse(answer.submittedAt));
  // A send that did not finish before the page went away: it goes again, as
  // the same request.
  const resumeFrom: Pending | undefined =
    usedDraft && draft.pending !== undefined
      ? {
          status: draft.pending.status,
          key: draft.pending.idempotencyKey,
          body: bodyOf(
            draft.pending.status,
            draft.pending.status === 'windows' ? draft.windows : [],
          ),
        }
      : undefined;
  const pending = useRef<Pending | undefined>(resumeFrom);
  const [phase, setPhase] = useState<Phase>(
    resumeFrom === undefined ? { kind: 'editing' } : { kind: 'offline', status: resumeFrom.status },
  );
  const [savedAt, setSavedAt] = useState<string | undefined>(usedDraft ? draft.savedAt : undefined);

  const answerable = ANSWERABLE_STATES.includes(plan.state);

  // A draft of a question the organiser has since changed.
  useEffect(() => {
    if (discardDraft && userId !== undefined) void clearDraft(userId, code);
  }, [discardDraft, userId, code]);

  // Opening the editor is the start of answering (§11.2's "median response
  // after link open" reads the last open before the answer).
  useEffect(() => {
    if (step === 'times' && answerable)
      track('availability_started', { plan_id: plan.id as PlanId });
  }, [step, answerable, plan.id]);

  // Every change goes to the device as it happens. Not the first render: a
  // stored answer copied into a draft would look newer than the answer, and
  // outrank an edit made later on another device.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current || userId === undefined) return;
    void writeDraft(userId, code, {
      plan,
      windows: windowsOf(state, rows, timing),
      flexible: state.flexible,
      ...(pending.current === undefined
        ? {}
        : {
            pending: { status: pending.current.status, idempotencyKey: pending.current.key },
          }),
    });
  }, [state, userId, code, plan, rows, timing]);

  const edit = (action: Parameters<typeof dispatch>[0]) => {
    touched.current = true;
    dispatch(action);
    setSavedAt(new Date().toISOString());
  };

  // Straight away, too, when there is a reason to think it will go now: the
  // page has just come back with a send it did not finish, or the plan has just
  // agreed to ask this person.
  const [resendNow, setResendNow] = useState(resumeFrom === undefined ? 0 : 1);
  const sendingRef = useRef(false);
  /** Asked the plan to add them once for this answer; a second refusal is real. */
  const askedOnce = useRef(false);

  const send = useCallback(
    async (status: ResponseStatus): Promise<void> => {
      if (sendingRef.current) return;
      const windows = status === 'windows' ? windowsOf(state, rows, timing) : [];
      const body = bodyOf(status, windows);
      // The same answer resent is the same request; a changed one is a new one.
      if (pending.current?.body !== body) {
        pending.current = { status, key: newIdempotencyKey(), body };
      }
      const { key } = pending.current;

      if (userId === undefined) {
        // No backend: the gallery's plan, and nowhere to send it.
        router.replace({ pathname: '/j/[code]/sent', params: { code } });
        return;
      }

      sendingRef.current = true;
      setPhase({ kind: 'sending', status });
      const now = new Date();
      await writeDraft(
        userId,
        code,
        {
          plan,
          windows: windowsOf(state, rows, timing),
          flexible: state.flexible,
          pending: { status, idempotencyKey: key },
        },
        now,
      );
      setSavedAt(now.toISOString());

      let refusal: unknown;
      try {
        await submitAnswer({
          planId: plan.id,
          revision: plan.revision,
          status,
          windows,
          idempotencyKey: key,
        });
      } catch (error) {
        refusal = error ?? new Error('submit failed');
      }
      sendingRef.current = false;

      if (refusal === undefined) {
        pending.current = undefined;
        await clearDraft(userId, code);
        track('availability_submitted', {
          plan_id: plan.id as PlanId,
          status,
          window_count: windows.length,
        });
        void queryClient.invalidateQueries({ queryKey: ['plan-to-answer', code] });
        router.replace({ pathname: '/j/[code]/sent', params: { code } });
        return;
      }

      // No answer at all: the times wait here and go when they can.
      if (isOffline() || (refusal instanceof FunctionError && refusal.problem === undefined)) {
        setPhase({ kind: 'offline', status });
        return;
      }
      const failure = failureOf(refusal);
      const reason = failure.kind === 'reason' ? failure.reason : undefined;
      const reference = failure.kind === 'offline' ? undefined : failure.reference;

      switch (reason) {
        case 'stale_revision':
          // The question changed under the answer. Ask the new one; the old
          // times are for dates that may not be in it.
          pending.current = undefined;
          await clearDraft(userId, code);
          onStale();
          return;
        case 'replies_closed':
          pending.current = undefined;
          await clearDraft(userId, code);
          setPhase({ kind: 'closed' });
          return;
        case 'not_a_participant': {
          // Joined after the plan was made, and the gate's ask has not landed
          // (ADR 0022): ask now, then send the same answer again. The refusal
          // released the key, so the resend is the same request.
          if (askedOnce.current) break;
          askedOnce.current = true;
          const outcome = await askToPlan(code as ShortCode);
          if (outcome === 'asked') {
            setPhase({ kind: 'offline', status });
            setResendNow((n) => n + 1);
            return;
          }
          if (outcome === 'closed') {
            setPhase({ kind: 'closed' });
            return;
          }
          setPhase({ kind: 'offline', status });
          return;
        }
        case 'in_progress':
          // The first send is still going through. It will answer the resend.
          setPhase({ kind: 'offline', status });
          return;
        case 'too_many_requests':
          setPhase({ kind: 'editing', problem: t('availability', 'too_many_tries') });
          return;
        default:
          break;
      }
      setPhase({ kind: 'error', status, reference });
    },
    [state, rows, timing, userId, code, plan, router, queryClient, onStale],
  );

  // While the times are waiting, every chance to send them is taken: the
  // connection coming back, the page coming back, and every thirty seconds.
  const waiting = phase.kind === 'offline' ? phase.status : undefined;
  useEffect(() => {
    if (waiting === undefined) return;
    const retry = () => void send(waiting);
    const stop = onChanceToResend(retry);
    const timer = setInterval(retry, RESEND_EVERY_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [waiting, send]);

  useEffect(() => {
    if (resendNow === 0 || waiting === undefined) return;
    // Next tick, not in the effect itself: sending updates the screen.
    const soon = setTimeout(() => void send(waiting), 0);
    return () => clearTimeout(soon);
    // Only when `resendNow` moves; `send` changing with every paint is not a
    // reason to send again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendNow]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const title = t('availability', 'title', { title: plan.title, dates: datesOf(plan) });

  if (!answerable || phase.kind === 'closed') {
    return <AvailabilityScreen state="expired" title={title} onBack={back} />;
  }

  if (phase.kind === 'offline' || phase.kind === 'error') {
    return (
      <OfflineScreen
        kind={phase.kind}
        title={title}
        savedAt={savedAt === undefined ? undefined : timeOfDay(savedAt)}
        reference={phase.kind === 'error' ? phase.reference : undefined}
        organiserName={plan.organiserName}
        onTryAgain={() => void send(phase.status)}
        onBack={back}
      />
    );
  }

  const sending = phase.kind === 'sending' ? phase.status : undefined;
  const problem = phase.kind === 'editing' ? phase.problem : undefined;

  if (step === 'none') {
    return (
      <NoneWorkScreen
        title={title}
        organiserName={plan.organiserName}
        sending={sending as NoneWorkStatus | undefined}
        problem={problem}
        onChoose={(status) => void send(status)}
        onBackToMyTimes={() =>
          router.canGoBack()
            ? router.back()
            : router.replace({ pathname: '/j/[code]', params: { code } })
        }
        onBack={back}
      />
    );
  }

  const days: DayView[] = rows.map((row, index) => {
    const cells = state.days[index] ?? [];
    return {
      key: row.date,
      short: row.short,
      spoken: row.spoken,
      cells,
      labels: row.cellLabels,
      marks: row.marks,
      range:
        rangeText(cellsToWindows(row.date, cells, timing), timing.zone, format) ??
        t('availability', 'not_this_day'),
      wholeDay: wholeDayOn(state, index),
    };
  });

  return (
    <AvailabilityScreen
      title={title}
      count={t('availability', 'painted_of', {
        painted: paintedDays(state),
        total: rows.length,
      })}
      intro={introOf(plan, format)}
      zoneNote={zoneNoteOf(plan)}
      shortcuts={planShortcuts(rows, timing).map((kind) => ({
        kind,
        label: SHORTCUT_LABEL[kind as Exclude<ShortcutKind, 'any_time'>](),
        on: shortcutOn(kind, state, rows, timing),
      }))}
      days={days}
      flexible={state.flexible}
      changed={changed}
      problem={problem}
      busy={sending !== undefined}
      onPaint={(day, cells) => edit({ type: 'paint', day, cells })}
      onShortcut={(kind) => edit({ type: 'shortcut', kind })}
      onWholeDay={(day) => edit({ type: 'whole_day', day })}
      onFlexible={(on) => edit({ type: 'flexible', on })}
      onSend={() => void send(statusOf(state))}
      onNoneOfTheseDates={() => router.push({ pathname: '/j/[code]/none', params: { code } })}
      onBack={back}
    />
  );
}

function statusOf(state: EditorState): ResponseStatus {
  return state.flexible ? 'flexible' : 'windows';
}

/** What an answer *is*, for telling a resend from a changed answer. */
function bodyOf(
  status: ResponseStatus,
  windows: readonly { start: string; end: string }[],
): string {
  return JSON.stringify({ status, windows: status === 'windows' ? windows : [] });
}

/** "14 Sep – 27 Sep", in the device's own date order. */
function datesOf(plan: AnswerablePlan): string {
  const short = (date: LocalDate) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
      new Date(`${date}T12:00:00Z`),
    );
  return `${short(localDate(plan.windowStart))} – ${short(localDate(plan.windowEnd))}`;
}

const WHAT: Record<AnswerablePlan['category'], () => string> = {
  catch_up: () => t('availability', 'what_catch_up'),
  dinner: () => t('availability', 'what_dinner'),
  drinks: () => t('availability', 'what_drinks'),
  coffee: () => t('availability', 'what_coffee'),
  activity: () => t('availability', 'what_activity'),
};

const DURATION: Record<AnswerablePlan['durationMinutes'], () => string> = {
  60: () => t('availability', 'duration_60'),
  90: () => t('availability', 'duration_90'),
  120: () => t('availability', 'duration_120'),
  180: () => t('availability', 'duration_180'),
};

/** "Catch-ups run about 2 hours. Replies close Tue 15 Sep, 6 pm." — in the plan's zone. */
function introOf(plan: AnswerablePlan, format: ReturnType<typeof deviceTimeFormat>): string {
  const closes = toLocal(fromISO(plan.responseDeadline), toZone(plan.zone));
  return t('availability', 'runs_about', {
    what: WHAT[plan.category](),
    duration: DURATION[plan.durationMinutes](),
    deadline: `${dateWords(closes.date, 'short')}, ${formatMinutesOfDay(closes.minutesOfDay, format)}`,
  });
}

/**
 * "Times are Melbourne time." when this device is somewhere else. The grid is
 * the plan's zone's clock — a half hour means the same moment to everybody in
 * the circle — so somebody away from home is told whose clock it is (§9).
 */
function zoneNoteOf(plan: AnswerablePlan): string | undefined {
  let here: string | undefined;
  try {
    here = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
  if (here === undefined || here === plan.zone) return undefined;
  const city = plan.zone.split('/').pop()?.replaceAll('_', ' ') ?? plan.zone;
  return t('availability', 'times_in_zone', { zone: city });
}

/** "5:42 pm", on this device's clock: when *this person* saved it. */
function timeOfDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}
