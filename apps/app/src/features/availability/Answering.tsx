import type { PlanId } from '@circles/contracts';
import { ANSWERABLE_STATES, cellsToWindows, rangeText, type ShortcutKind } from '@circles/domain';
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
import { AvailabilityScreen, type DayView } from './AvailabilityScreen';
import { dayRows, deviceTimeFormat } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  paintedDays,
  planShortcuts,
  shortcutOn,
  wholeDayOn,
  type EditorAction,
  type EditorState,
} from './editor';
import { NoneWorkScreen, type NoneWorkStatus } from './NoneWorkScreen';
import { useSendAnswer } from './useSendAnswer';
import { ROW_WORDS, SHORTCUT_LABEL, introOf, timeOfDay, titleOf, zoneNoteOf } from './words';

/**
 * One question, being answered: the editor, "none of these dates", and the
 * offline and closed states around them (spec §5.5). Mounted once per plan
 * revision, so nothing painted against old dates reaches a new grid.
 */
export type AvailabilityStep = 'times' | 'none';

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

/** Whether the device's draft is what the person last did: newer than the stored answer. */
export function draftIsNewer(draft: Draft | undefined, answer: OwnAnswer | null): boolean {
  return (
    draft !== undefined &&
    (answer === null || Date.parse(draft.savedAt) > Date.parse(answer.submittedAt))
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

  const answerable = ANSWERABLE_STATES.includes(plan.state);

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
    edited();
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
      count={t('availability', 'painted_of', { painted: paintedDays(state), total: rows.length })}
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
      onSend={() => void send(state.flexible ? 'flexible' : 'windows')}
      onNoneOfTheseDates={() => router.push({ pathname: '/j/[code]/none', params: { code } })}
      onBack={back}
    />
  );
}
