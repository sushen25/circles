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
import type { GridPaint } from '../../components';
import { t } from '../../copy';
import { OfflineScreen } from '../system/OfflineScreen';
import { AvailabilityScreen } from './AvailabilityScreen';
import type { BlockKind, BlockTiming } from './blocks';
import { dayRows, deviceTimeFormat } from './days';
import {
  editorFrom,
  editorReducer,
  emptyEditor,
  strokeDays,
  type EditorAction,
  type EditorState,
} from './editor';
import { NoneWorkScreen, type NoneWorkStatus } from './NoneWorkScreen';
import { useOthersSaid } from './useOthersSaid';
import { sharedTime } from './sharedTime';
import { useStartedEvent } from './usePreviousTimes';
import { useSendAnswer, type ReturnTo } from './useSendAnswer';
import { editorView } from './view';
import {
  BLOCK_LABEL,
  closesOf,
  guideOf,
  noneOf,
  questionOf,
  thingOf,
  timeOfDay,
  titleOf,
  zoneNoteOf,
} from './words';

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
  /** The gallery's way in to "A time for each day", and to a day's sheet (SUS-236). */
  opening?: 'each' | 'sheet' | undefined;
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
  opening,
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
  const rows = useMemo(() => dayRows(timing), [timing]);
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
    const started = start();
    // The gallery's sheet-open state: Wednesday's hours.
    return opening === 'sheet' ? { ...started, open: 2 } : started;
  });

  // "A time for each day" and a day's sheet are views of the same answer: which
  // is on show is the person's place in the screen, never stored or sent. The
  // block opens as the list when the days already differ (ADR 0079).
  const [each, setEach] = useState(
    () => opening !== undefined || sharedTime(state, rows, timing, format)?.same === false,
  );
  // The choice a day had before its clock was tapped, for "Back to Evening instead".
  const [before, setBefore] = useState<BlockKind | undefined>(undefined);

  const { said, pending: othersPending } = useOthersSaid({
    plan,
    userId,
    step,
    fixtureOthers,
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
    onNarrowed,
    returnTo,
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
  // after link open" reads the last open before the answer). An answer never
  // given opens empty (ADR 0077): previous times are not applied on open, so
  // none are on offer and `usual_offered` is false, which is true.
  const view = editorView(state, rows, timing, format, undefined, undefined, said);
  useStartedEvent({
    active: step === 'times' && answerable,
    planId: plan.id,
    settled: true,
    offered: false,
  });

  // While an answer is on its way it cannot change: the request has the
  // answer it was sent with, and a success clears the draft an edit would
  // have been written to.
  const sending = phase.kind === 'sending' ? phase.status : undefined;
  const edit = (action: EditorAction) => {
    if (sending !== undefined) return;
    // Opening a day changes what is on screen, not the answer: it is not an
    // edit, and it writes no draft.
    if (!VIEW_ONLY.has(action.type)) edited();
    dispatch(action);
  };

  // Dragging across the grid taps or untaps the days it crosses, from the day
  // the stroke began on, and gives back a day it crossed and left (SUS-133).
  const stroke = useRef<{ base: boolean[][]; anchor: number } | undefined>(undefined);
  const strokeTo = (current: number) => {
    if (stroke.current === undefined) return;
    const { base, anchor } = stroke.current;
    edit({
      type: 'stroke',
      days: strokeDays(base, rows, timing, state.window, anchor, current),
    });
  };
  const paintDays: GridPaint = {
    begin: (index) => {
      stroke.current = { base: state.days, anchor: index };
      strokeTo(index);
    },
    extend: strokeTo,
    end: () => {
      stroke.current = undefined;
    },
  };

  const expanded = view.block !== undefined && (each || view.block.differ);
  const sheetRow =
    state.open === undefined ? undefined : view.rows.find((r) => r.day === state.open);
  // With no day left the list has nothing to list: the next tap starts on the pills.
  if (view.block === undefined && each) setEach(false);

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

  return (
    <AvailabilityScreen
      title={title}
      question={questionOf(view.band, view.single)}
      noneLabel={noneOf(view.band, view.single)}
      single={view.single}
      onPaintDays={paintDays}
      guide={guideOf(view.counted, view.band, view.single)}
      guideRoom={othersPending ? guideOf(true, view.band, view.single) : undefined}
      closes={closesOf(plan, format)}
      zoneNote={zoneNoteOf(plan)}
      grid={view.grid}
      weekdays={view.weekdays}
      block={view.block}
      expanded={expanded}
      rows={view.rows}
      singleHeading={t('availability', 'hours_title', { thing: thingOf(view.band) })}
      sheetRow={sheetRow}
      backTo={before === undefined ? undefined : BLOCK_LABEL[before]()}
      flexible={state.flexible}
      changed={changed}
      problem={problem}
      busy={sending !== undefined}
      onTick={(day) => edit({ type: 'toggle_day', day })}
      onChooseWindow={(kind) => edit({ type: 'set_window', kind })}
      onExpand={() => setEach(true)}
      onCollapse={() => {
        edit({ type: 'use_one_time' });
        setEach(false);
      }}
      onChooseDay={(day, kind) => edit({ type: 'set_day_window', day, kind })}
      onOpenDay={(day) => {
        setBefore(view.rows.find((row) => row.day === day)?.window);
        edit({ type: 'open', day });
      }}
      onPaintDay={(day, cells) => edit({ type: 'paint', day, cells })}
      onSheetDone={() => edit({ type: 'close' })}
      onBackToChoice={() => {
        if (state.open !== undefined && before !== undefined) {
          edit({ type: 'set_day_window', day: state.open, kind: before });
        }
        edit({ type: 'close' });
      }}
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
