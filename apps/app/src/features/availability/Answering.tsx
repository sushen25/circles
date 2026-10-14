import { fromISO, isTonightWindow, type OthersSaid } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  clearDraft,
  timingOf,
  type AnswerablePlan,
  type Draft,
  type OwnAnswer,
} from '../../data/availability';
import { OfflineScreen } from '../system/OfflineScreen';
import { AvailabilityScreen } from './AvailabilityScreen';
import type { BlockTiming } from './blocks';
import { ExactHoursScreen } from './ExactHoursScreen';
import { dayRows, deviceTimeFormat } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  type EditorAction,
  type EditorState,
} from './editor';
import { NoneWorkScreen, type NoneWorkStatus } from './NoneWorkScreen';
import { useOthersSaid } from './useOthersSaid';
import { usePreviousTimes, useStartedEvent } from './usePreviousTimes';
import { useSendAnswer, type ReturnTo } from './useSendAnswer';
import { editorView } from './view';
import { ROW_WORDS, closesOf, guideOf, timeOfDay, titleOf, zoneNoteOf } from './words';

/**
 * One question, being answered: the editor, "none of these dates", and the
 * offline and closed states around them (spec §5.5). Mounted once per plan
 * revision, so nothing painted against old dates reaches a new grid.
 */
export type AvailabilityStep = 'times' | 'none';

const VIEW_ONLY: ReadonlySet<EditorAction['type']> = new Set(['open', 'close']);

export type AnsweringProps = {
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
  /** Days taken away from the same question (ADR 0047): fetch the plan again. */
  onNarrowed?: (() => void) | undefined;
  /** Where a sent answer goes, when it is not the sent screen (SUS-158). */
  returnTo?: ReturnTo | undefined;
  /** With no backend, what the others said in the gallery's scenario (SUS-129). */
  fixtureOthers?: OthersSaid | undefined;
};

/**
 * Whether the editor opens from the device's draft rather than the stored
 * answer: when the draft is what the person last did (newer), and always when
 * it holds a send that never got its reply. That send may well have committed —
 * which makes the stored answer the newer of the two — and resending it under
 * its key is what finds out, replays the reply, and clears the draft.
 */
export function draftIsNewer(draft: Draft | undefined, answer: OwnAnswer | null): boolean {
  return (
    draft !== undefined &&
    (draft.pending !== undefined ||
      answer === null ||
      Date.parse(draft.savedAt) > Date.parse(answer.submittedAt))
  );
}

export function Answering({
  code,
  step,
  plan,
  answer,
  draft,
  discardDraft = false,
  changed,
  userId,
  onStale,
  onNarrowed,
  returnTo,
  fixtureOthers,
}: AnsweringProps) {
  const router = useRouter();

  // A plan about tonight, opened on the day, offers "From now" and "Later
  // tonight" instead of the parts of a day that is already under way (S2-06),
  // counted from the moment the editor opened.
  const [openedAt] = useState(() => fromISO(new Date().toISOString()));
  const timing = useMemo((): BlockTiming => {
    const base = timingOf(plan);
    return isTonightWindow(base.window, base.zone, openedAt)
      ? { ...base, tonight: openedAt }
      : base;
  }, [plan, openedAt]);
  const format = useMemo(() => deviceTimeFormat(), []);
  const rows = useMemo(() => dayRows(timing, format, ROW_WORDS), [timing, format]);
  const reducer = useMemo(() => editorReducer(rows, timing), [rows, timing]);

  // Where the answer starts: the device's draft when it is the newer of the
  // two, the stored answer otherwise, and nothing when there is neither.
  const [opened] = useState(() => (draftIsNewer(draft, answer) ? draft : undefined));
  const [state, dispatch] = useReducer(reducer, undefined, (): EditorState => {
    const start = (): EditorState => {
      if (opened !== undefined) return editorFrom(rows, timing, opened.windows, opened.flexible);
      if (answer !== null) {
        const windows = answer.status === 'windows' ? answer.windows : [];
        return editorFrom(rows, timing, windows, answer.status === 'flexible');
      }
      return emptyEditor(rows, timing);
    };
    return start();
  });

  // "Change time" and the half hours are views of the same answer: which one is
  // on show is the person's place in the screen, never stored or sent.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Once the person has changed anything, previous times no longer start the
  // answer: clearing their last day is a choice, not an empty answer to fill.
  const [touched, setTouched] = useState(false);
  const [exact, setExact] = useState(false);

  // Previous times (ADR 0037's amendment, ADR 0068): the reader's own earlier
  // offers, only the parts this plan asks about, in one request. They start an
  // answer that has never been given — the days are tapped and the line says
  // what they are — and are never sent: Send is still the person's.
  const previous = usePreviousTimes({
    planId: plan.id,
    userId,
    enabled: plan.acceptingAnswers,
  });

  const said = useOthersSaid({ plan, userId, step, fixtureOthers });

  const { phase, send, savedAt, edited } = useSendAnswer({
    code,
    plan,
    userId,
    state,
    rows,
    timing,
    draft: opened,
    onStale,
    onNarrowed,
    returnTo,
    usedPrevious: previous.used,
  });

  // Judged by the server when the plan was read (`acceptingAnswers`): state and
  // deadline, on the database's clock, not this device's (round 6). A page
  // left open past the deadline learns it from `replies_closed` on sending.
  const answerable = plan.acceptingAnswers;

  // A draft of a question the organiser has since changed.
  useEffect(() => {
    if (discardDraft && userId !== undefined) void clearDraft(userId, code);
  }, [discardDraft, userId, code]);

  // Opening the editor is the start of answering (§11.2's "median response
  // after link open" reads the last open before the answer), with whether
  // previous times were on offer (SUS-159).
  const view = editorView(state, rows, timing, format, undefined, previous.parts, said);
  useStartedEvent({
    active: step === 'times' && answerable,
    planId: plan.id,
    settled: previous.settled,
    offered: view.canUseUsual,
  });

  // Previous times start an answer that has never been given: the days are
  // tapped and the line says what they are. View-only — a start, not an edit,
  // so it writes no draft until the person changes something.
  const prefill = answer === null && opened === undefined && !touched && view.canUseUsual;
  const prefilled = useRef(false);
  const parts = previous.parts;
  const markUsed = previous.markUsed;
  useEffect(() => {
    if (!prefill || prefilled.current || parts === undefined) return;
    prefilled.current = true;
    markUsed();
    dispatch({ type: 'usual', parts });
  }, [prefill, parts, markUsed]);

  // While an answer is on its way it cannot change: the request has the
  // answer it was sent with, and a success clears the draft an edit would
  // have been written to.
  const sending = phase.kind === 'sending' ? phase.status : undefined;
  const edit = (action: EditorAction) => {
    if (sending !== undefined) return;
    // Opening a day changes what is on screen, not the answer: it is not an
    // edit, and it writes no draft.
    if (!VIEW_ONLY.has(action.type)) {
      edited();
      setTouched(true);
    }
    dispatch(action);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const title = titleOf(plan);

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

  if (exact) {
    return (
      <ExactHoursScreen
        title={title}
        answers={view.answers}
        canUndo={view.canUndo}
        busy={sending !== undefined}
        onOpen={(day) => edit({ type: 'open', day })}
        onPaint={(day, cells) => edit({ type: 'paint', day, cells })}
        onWholeDay={(day) => edit({ type: 'whole_day', day })}
        onRemoveDay={(day) => edit({ type: 'remove_day', day })}
        onStartOver={() => edit({ type: 'start_over' })}
        onUndo={() => edit({ type: 'undo' })}
        onDone={() => {
          edit({ type: 'close' });
          setExact(false);
        }}
      />
    );
  }

  return (
    <AvailabilityScreen
      title={title}
      guide={guideOf(view.counted)}
      closes={closesOf(plan, format)}
      zoneNote={zoneNoteOf(plan)}
      grid={view.grid}
      weekdays={view.weekdays}
      answerLine={view.answerLine}
      sheet={view.sheet}
      sheetOpen={sheetOpen}
      flexible={state.flexible}
      changed={changed}
      problem={problem}
      busy={sending !== undefined}
      onTick={(day) => edit({ type: 'toggle_day', day })}
      onChangeTime={() => setSheetOpen(true)}
      onChooseWindow={(kind) => edit({ type: 'set_window', kind })}
      onExactHours={() => {
        setSheetOpen(false);
        // The first tapped day opens, so the half hours are in view at once.
        const first = view.answers[0];
        if (first !== undefined && state.open === undefined) edit({ type: 'open', day: first.day });
        setExact(true);
      }}
      onSheetDone={() => setSheetOpen(false)}
      onFlexible={(on) => edit({ type: 'flexible', on })}
      onSend={() => void send(state.flexible ? 'flexible' : 'windows')}
      onNoneOfTheseDates={() =>
        router.push({
          pathname: '/j/[code]/none',
          params: returnTo === undefined ? { code } : { code, returnTo },
        })
      }
      onBack={back}
    />
  );
}
