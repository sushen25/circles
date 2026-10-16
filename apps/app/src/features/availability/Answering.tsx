import { fromISO, isTonightWindow, type OthersSaid } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

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
import type { BlockTiming } from './blocks';
import { ExactHoursScreen } from './ExactHoursScreen';
import { dayRows, deviceTimeFormat } from './days';
import { handoffKey } from './hoursStep';
import { useHoursHandoff, useHoursStep } from './useHoursStep';
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
import { useStartedEvent } from './usePreviousTimes';
import { useSendAnswer, type ReturnTo } from './useSendAnswer';
import { editorView } from './view';
import {
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
  const rows = useMemo(() => dayRows(timing), [timing]);
  const reducer = useMemo(() => editorReducer(rows, timing), [rows, timing]);

  // Where the answer starts: the device's draft when it is the newer of the
  // two, the stored answer otherwise, and nothing when there is neither.
  const [opened] = useState(() => (draftIsNewer(draft, answer) ? draft : undefined));
  // "A time for each day" is the plan link's `?step=hours`, an entry of its own
  // in the history (SUS-209). This page load pushed it, so this is the step's
  // editor, started from the first screen's answer. The first screen's own
  // address never gains the step, so which of the two this is does not change.
  const handoff = handoffKey(code, plan, userId);
  const hours = useHoursStep(code, handoff);
  const { exact, focused } = hours;
  const [state, dispatch] = useReducer(reducer, undefined, (): EditorState => {
    const start = (): EditorState => {
      if (hours.handed !== undefined) return hours.handed.state;
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
  // Whether the person has changed anything. Nothing acts on it since ADR 0077
  // stopped previous times starting an answer on open; it travels with the
  // hours step's handoff (SUS-209) for the explicit tap that is to come.
  const [touched, setTouched] = useState(() => hours.handed?.touched ?? false);
  const openHours = () => hours.open(state, touched);
  const closeHours = hours.close;
  // Leaving the step waits for the answer to be handed back: the change and the
  // pop in one tap would unmount the step before its last change was shared.
  const [leaving, setLeaving] = useState(false);

  // The device's back button leaves the half hours for the answer, as the
  // screen's own does, rather than the page (Android; the web has no such button
  // and its browser's Back leaves the route, as it does from the sheet).
  useEffect(() => {
    // react-native-web logs an error if asked: there is no such button there.
    if (!exact || Platform.OS === 'web') return;
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ type: 'close' });
      setLeaving(true);
      return true;
    });
    return () => hardware.remove();
  }, [exact]);

  const { said, pending: othersPending } = useOthersSaid({
    plan,
    userId,
    step: exact ? 'none' : step,
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
    active: step === 'times' && answerable && !exact,
    planId: plan.id,
    settled: true,
    offered: false,
  });

  // Painting a day's last half hour off untaps it: with no day left there is
  // nothing to give a time to, so the step is left for the first screen.
  const noDays = exact && view.cards.length === 0;
  useHoursHandoff({
    exact,
    handoff,
    state,
    touched,
    restore: (answer) => {
      dispatch({ type: 'load', state: answer.state });
      setTouched(answer.touched);
    },
  });
  useEffect(() => {
    if (leaving) closeHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  useEffect(() => {
    if (noDays) closeHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noDays]);

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

  // "A time for each day": every tapped day is a card with the plan's quick
  // choices, and the half hours are one tap away on each.
  const openEach = openHours;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const title = titleOf(plan);

  if (!focused) return null;

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

  if (exact && !noDays) {
    return (
      <ExactHoursScreen
        title={title}
        single={
          view.single
            ? {
                heading: t('availability', 'hours_title', { thing: thingOf(view.band) }),
                body: t('availability', 'hours_body', {
                  thing: thingOf(view.band),
                  time: view.singleTime ?? '',
                }),
              }
            : undefined
        }
        cards={view.cards}
        busy={sending !== undefined}
        onChoose={(day, kind) => edit({ type: 'set_day_window', day, kind })}
        onOpen={(day) => edit({ type: 'open', day })}
        onPaint={(day, cells) => edit({ type: 'paint', day, cells })}
        onOneTime={() => {
          edit({ type: 'use_one_time' });
          edit({ type: 'close' });
          setLeaving(true);
        }}
        onDone={() => {
          edit({ type: 'close' });
          setLeaving(true);
        }}
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
      answerLine={view.answerLine}
      sheet={view.sheet}
      sheetOpen={sheetOpen}
      flexible={state.flexible}
      changed={changed}
      problem={problem}
      busy={sending !== undefined}
      onTick={(day) => edit({ type: 'toggle_day', day })}
      onChangeTime={() => {
        // The plan leaves one window, or the days differ: the screen that says
        // each day's. The days share a time: the sheet.
        if (view.single || view.answerLine?.shared === false) openEach();
        else setSheetOpen(true);
      }}
      onChooseWindow={(kind) => edit({ type: 'set_window', kind })}
      onExactHours={() => {
        setSheetOpen(false);
        openEach();
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
