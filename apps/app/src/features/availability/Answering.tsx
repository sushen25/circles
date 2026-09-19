import type { PlanId } from '@circles/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import {
  clearDraft,
  timingOf,
  type AnswerablePlan,
  type Draft,
  type OwnAnswer,
} from '../../data/availability';
import { OfflineScreen } from '../system/OfflineScreen';
import { AvailabilityScreen } from './AvailabilityScreen';
import { dayRows, deviceTimeFormat } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  type EditorAction,
  type EditorState,
} from './editor';
import { NoneWorkScreen, type NoneWorkStatus } from './NoneWorkScreen';
import { useSendAnswer } from './useSendAnswer';
import { editorView } from './view';
import { ROW_WORDS, introOf, timeOfDay, titleOf, zoneNoteOf } from './words';

/**
 * One question, being answered: the editor, "none of these dates", and the
 * offline and closed states around them (spec §5.5). Mounted once per plan
 * revision, so nothing painted against old dates reaches a new grid.
 */
export type AvailabilityStep = 'times' | 'none';

const VIEW_ONLY: ReadonlySet<EditorAction['type']> = new Set(['tick', 'done', 'open']);

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
}: AnsweringProps) {
  const router = useRouter();

  const timing = useMemo(() => timingOf(plan), [plan]);
  const format = useMemo(() => deviceTimeFormat(), []);
  const rows = useMemo(() => dayRows(timing, format, ROW_WORDS), [timing, format]);
  const reducer = useMemo(() => editorReducer(rows, timing), [rows, timing]);

  // Where the answer starts: the device's draft when it is the newer of the
  // two, the stored answer otherwise, and nothing when there is neither.
  const [opened] = useState(() => (draftIsNewer(draft, answer) ? draft : undefined));
  const [state, dispatch] = useReducer(reducer, undefined, (): EditorState => {
    if (opened !== undefined) return editorFrom(rows, timing, opened.windows, opened.flexible);
    if (answer !== null) {
      const windows = answer.status === 'windows' ? answer.windows : [];
      return editorFrom(rows, timing, windows, answer.status === 'flexible');
    }
    return emptyEditor(rows);
  });

  const { phase, send, savedAt, edited } = useSendAnswer({
    code,
    plan,
    userId,
    state,
    rows,
    timing,
    draft: opened,
    onStale,
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
  // after link open" reads the last open before the answer).
  useEffect(() => {
    if (step === 'times' && answerable) {
      track('availability_started', { plan_id: plan.id as PlanId });
    }
  }, [step, answerable, plan.id]);

  // While an answer is on its way it cannot change: the request has the
  // answer it was sent with, and a success clears the draft an edit would
  // have been written to.
  const sending = phase.kind === 'sending' ? phase.status : undefined;
  const edit = (action: EditorAction) => {
    if (sending !== undefined) return;
    // Ticking a day or opening one changes what is on screen, not the answer:
    // it is not the first edit, and it writes no draft.
    if (!VIEW_ONLY.has(action.type)) edited();
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

  const view = editorView(state, rows, timing, format);

  return (
    <AvailabilityScreen
      title={title}
      count={t('availability', 'painted_of', { painted: view.painted, total: rows.length })}
      intro={introOf(plan, format)}
      zoneNote={zoneNoteOf(plan)}
      grid={view.grid}
      weekdays={view.weekdays}
      panel={view.panel}
      answers={view.answers}
      canUndo={view.canUndo}
      flexible={state.flexible}
      changed={changed}
      problem={problem}
      busy={sending !== undefined}
      onTick={(day) => edit({ type: 'tick', day })}
      onDone={() => edit({ type: 'done' })}
      onBlock={(kind) => edit({ type: 'block', kind })}
      onClearTicked={() => edit({ type: 'clear_ticked' })}
      onOpen={(day) => edit({ type: 'open', day })}
      onPaint={(day, cells) => edit({ type: 'paint', day, cells })}
      onWholeDay={(day) => edit({ type: 'whole_day', day })}
      onRemoveDay={(day) => edit({ type: 'remove_day', day })}
      onStartOver={() => edit({ type: 'start_over' })}
      onUndo={() => edit({ type: 'undo' })}
      onFlexible={(on) => edit({ type: 'flexible', on })}
      onSend={() => void send(state.flexible ? 'flexible' : 'windows')}
      onNoneOfTheseDates={() => router.push({ pathname: '/j/[code]/none', params: { code } })}
      onBack={back}
    />
  );
}
