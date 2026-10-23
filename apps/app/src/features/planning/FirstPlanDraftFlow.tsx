import { fromISO, type DurationMinutes } from '@circles/domain';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import {
  DEFAULT_PLAN,
  readDraft,
  type DraftAnswer,
  type DraftPatch,
  type DraftPlan,
  type OrganiserDraft,
} from '../../data/draft';
import { weekdayHeadings } from '../availability/days';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { isOffline } from '../identity/join/failure';
import { AdjustSheet } from './AdjustSheet';
import { draftCard } from './draftPlan';
import {
  WINDOW_CHIPS,
  bandOf,
  closesShort,
  daysOf,
  gridDays,
  headingFor,
  lengthLabel,
  replyChoices,
  timeOfDay,
  unitOf,
  windowChipLabel,
  type TimeOfDay,
  type WindowChip,
} from './firstEvenings';
import { FirstEveningsScreen } from './FirstEveningsScreen';
import { presetAvailable, windowOf } from './form';
import { useDraftZone } from './useDraftZone';
import { useEveningPicks } from './useEveningPicks';

/**
 * `/circles/new/plan` — screen 2 of the first run, drafted before there is a
 * circle (spec §5.1, ADR 0053, SUS-247): which evenings could the organiser do.
 *
 * The plan is worked out from the same rules as the one the server will make,
 * over a circle of one in the device's zone with no default of its own; the
 * window is a chip (Monthly, the default, Next 2 weeks, This weekend), the days
 * are the guests' calendar, and everything else is one line and **Adjust**.
 * **Adjust** is time of day, how long and when replies close; **More options**
 * reaches the full setup (`/circles/new/plan/setup`), which works on the same
 * draft and sends nothing. The screen reads the draft whenever it is seen, so
 * what the setup saved is what it shows.
 *
 * **The days are the organiser's own answer** and are written to the draft as
 * they are picked (after a pause, and when they go on), so a reload or the
 * round trip to the email brings them back. The finish sends them after the plan
 * is made (`finishDraft`). Next waits until a day is picked, or until the
 * organiser says they will add theirs later.
 *
 * Somebody with a saved place goes straight to the finish ("Make the link"); a
 * guest, or nobody, goes to **Who's asking?**, the one gate, before the share.
 */
export function FirstPlanDraftFlow() {
  return hasBackend() ? <LiveFirstPlanDraft /> : <FixtureFirstPlanDraft />;
}

/** How long a tapped day waits for the next before it is written down. */
const SAVE_AFTER_MS = 300;

/** No backend: the gallery and the fixture journey, which carry on to Who's asking. */
function FixtureFirstPlanDraft() {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [openedAt] = useState(() => Date.now());
  const zone = useDraftZone().zone;
  const card = draftCard(DEFAULT_PLAN, zone, openedAt);
  const days = daysOf(card.resolved.window);
  const picks = useEveningPicks(days, picked, setPicked);
  const unit = unitOf(card.plan.preset, card.resolved.band);
  return (
    <FirstEveningsScreen
      circleName={t('firstPlan', 'sunday_crew')}
      heading={headingFor(card.plan.preset, card.resolved.band)}
      windows={WINDOW_CHIPS.map((each) => ({
        key: each,
        label: windowChipLabel(each),
        selected: each === card.plan.preset,
        onPress: () => undefined,
      }))}
      weekdays={weekdayHeadings()}
      days={gridDays(days, new Set(picked), unit)}
      onToggle={picks.onDay}
      onPaint={picks.paint}
      picked={picked.length}
      planLine={t('firstRun', 'plan_line', {
        when: t('firstRun', unit === 'evening' ? 'plan_evenings' : 'plan_days'),
        length: lengthLabel(card.plan.duration).toLowerCase(),
        closes: closesShort(card.resolved.deadline, zone),
      })}
      onAdjust={() => router.push('/circles/sunday-crew/plan/setup')}
      onNext={(go) => go(() => router.push('/circles/new/save'))}
      onLater={(go) => go(() => router.push('/circles/new/save'))}
      onBack={() => router.back()}
    />
  );
}

function LiveFirstPlanDraft() {
  const router = useRouter();
  const where = useDraftZone();
  const { loaded, draft, save } = useOrganiserDraft();

  // The moment the screen was opened: the plan is previewed as one made about
  // now, and a clock read during a render would make it a different plan each
  // time. Coming back from the setup is a new look at the clock.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setOpenedAt(Date.now()), []));

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [missing, setMissing] = useState<string | undefined>();
  // The days as the grid has them, which is ahead of the draft by a pause.
  const [picks, setPicks] = useState<string[] | undefined>();
  const edited = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const noDraft = loaded && (draft === null || draft.circleName.trim() === '');
  useEffect(() => {
    if (noDraft) router.replace('/circles/new');
  }, [noDraft, router]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles/new'));

  const ready = loaded && !noDraft && draft !== null;
  const zone = where.zone;
  const card = ready ? draftCard(draft.plan, zone, openedAt) : undefined;
  const days = card === undefined ? [] : daysOf(card.resolved.window);
  const inWindow = new Set(days);
  // What was picked before a reload comes back from the draft until the person touches the grid.
  const picked = (picks ?? draft?.answer?.days ?? []).filter((day) => inWindow.has(day));

  const setPicked = (next: string[]) => {
    edited.current = true;
    setMissing(undefined);
    setPicks(next);
  };
  const grid = useEveningPicks(days, picked, setPicked);

  /**
   * A change made to the draft as the device holds it **now**, one at a time, in
   * the order they were asked: two quick taps in Adjust, or a pick and a tap,
   * each build on the one before and not on the render they were made in.
   */
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const editLatest = (change: (latest: OrganiserDraft) => DraftPatch): Promise<unknown> => {
    writes.current = writes.current
      .then(async () => {
        const latest = await readDraft();
        if (latest !== null) await save(change(latest));
      })
      .catch(() => undefined);
    return writes.current;
  };
  const answerOf = (latest: OrganiserDraft, change: Partial<DraftAnswer> = {}): DraftAnswer => ({
    ...(latest.answer ?? { days: [] }),
    ...change,
  });

  // Written after the person pauses. Only an edit is written: opening the
  // screen with a draft behind it must not renew it.
  useEffect(() => {
    if (!edited.current || !ready) return;
    pending.current = setTimeout(
      () =>
        void editLatest((latest) => ({
          answer: answerOf(latest, { days: picked, later: false }),
        })),
      SAVE_AFTER_MS,
    );
    return () => clearTimeout(pending.current);
    // The draft is not a dependency: writing it would write again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, ready]);

  if (where.state === 'error') {
    // Not a profile with no zone: the plan would be worked out in the device's,
    // and the circle is made in the profile's.
    return (
      <FirstEveningsScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={where.retry}
        onBack={back}
      />
    );
  }
  if (!ready || card === undefined || draft === null || where.state === 'loading') {
    return <FirstEveningsScreen state="loading" circleName="" onBack={back} />;
  }

  const opened = fromISO(new Date(openedAt).toISOString());
  const plan = card.plan;
  const band = card.resolved.band;
  const unit = unitOf(plan.preset, band);
  const steps = where.signedIn ? 2 : 3;

  /** The plan with a different window: its own dates and deadline, the time of day the person chose. */
  const withWindow = (from: OrganiserDraft, preset: WindowChip): DraftPlan => {
    const next: DraftPlan = { ...from.plan, preset };
    delete next.custom;
    delete next.deadline;
    delete next.band;
    const choice = from.answer?.band;
    if (choice !== undefined) {
      const own = windowOf(preset, undefined, undefined, from.plan.duration, opened, zone);
      if (typeof own !== 'string' && timeOfDay(own.band) !== choice) next.band = bandOf(choice);
    }
    return next;
  };

  const chooseWindow = (preset: WindowChip) => {
    if (busy || preset === plan.preset) return;
    clearTimeout(pending.current);
    edited.current = false;
    // The days kept are those the new window asks about; the grid shows them at once.
    const nextDays = daysOf(draftCard(withWindow(draft, preset), zone, openedAt).resolved.window);
    const keep = picked.filter((day) => nextDays.includes(day));
    setPicks(keep);
    setMissing(undefined);
    void editLatest((latest) => ({
      plan: withWindow(latest, preset),
      answer: answerOf(latest, { days: keep }),
    }));
  };

  const chooseTimeOfDay = (choice: TimeOfDay) => {
    void editLatest((latest) => {
      const next: DraftPlan = { ...latest.plan };
      delete next.band;
      const own = windowOf(
        latest.plan.preset,
        latest.plan.custom,
        undefined,
        latest.plan.duration,
        opened,
        zone,
      );
      if (typeof own === 'string' || timeOfDay(own.band) !== choice) next.band = bandOf(choice);
      delete next.deadline;
      return { plan: next, answer: answerOf(latest, { band: choice }) };
    });
  };

  const chooseDuration = (duration: DurationMinutes) => {
    void editLatest((latest) => ({ plan: { ...latest.plan, duration } }));
  };

  const base = draftCard({ ...plan, deadline: undefined } as DraftPlan, zone, openedAt);
  const chooseReplies = (iso: string) => {
    void editLatest((latest) => {
      const next: DraftPlan = { ...latest.plan, deadline: iso };
      if (iso === base.resolved.deadline) delete next.deadline;
      return { plan: next };
    });
  };

  const leaveFor = async (change: Partial<DraftAnswer>, go: (navigate: () => void) => void) => {
    clearTimeout(pending.current);
    await writes.current;
    // The draft as the device holds it now, not as this render saw it: a window
    // or a length just chosen may still be on its way to being written, and
    // reading goes through the same line as the writes, so it comes after them.
    // Writing the render's copy back would put the old plan over the new one.
    const latest = await readDraft();
    if (latest === null) {
      router.replace('/circles/new');
      return;
    }
    await save({
      circleName: latest.circleName,
      // The whole plan, not a patch: one that ran out since it was drawn falls
      // back here, and not at the server after the circle is made.
      plan: draftCard(latest.plan, zone, Date.now()).plan,
      answer: answerOf(latest, { days: picked, ...change }),
      proceed: where.signedIn,
    });
    go(() => router.push(where.signedIn ? '/circles/new/finish' : '/circles/new/save'));
  };

  const next = async (go: (navigate: () => void) => void) => {
    if (busy) return;
    if (picked.length === 0 && draft.answer?.later !== true) {
      setMissing(t('firstRun', unit === 'evening' ? 'pick_an_evening' : 'pick_a_day'));
      return;
    }
    setBusy(where.signedIn);
    try {
      await leaveFor({ later: picked.length === 0 }, go);
    } finally {
      if (!where.signedIn) setBusy(false);
    }
  };

  const durations = plan.duration;
  return (
    <FirstEveningsScreen
      circleName={draft.circleName}
      steps={steps}
      heading={headingFor(plan.preset, band)}
      windows={WINDOW_CHIPS.map((each) => ({
        key: each,
        label: windowChipLabel(each),
        selected: each === plan.preset,
        disabled: !presetAvailable(each, plan.band, plan.duration, opened, zone),
        onPress: () => chooseWindow(each),
      }))}
      weekdays={weekdayHeadings()}
      days={gridDays(days, new Set(picked), unit)}
      onToggle={grid.onDay}
      onPaint={grid.paint}
      picked={picked.length}
      ready={picked.length > 0 || draft.answer?.later === true}
      missing={missing}
      planLine={t('firstRun', 'plan_line', {
        when: t('firstRun', unit === 'evening' ? 'plan_evenings' : 'plan_days'),
        length: lengthLabel(durations).toLowerCase(),
        closes: closesShort(card.resolved.deadline, zone),
      })}
      makesTheLink={where.signedIn}
      busy={busy}
      onAdjust={() => setSheet(true)}
      onLater={(go) => void leaveFor({ days: [], later: true }, go)}
      onNext={(go) => void next(go)}
      onBack={back}
      sheet={
        <AdjustSheet
          visible={sheet}
          timeOfDay={timeOfDay(band)}
          duration={plan.duration}
          replies={replyChoices(
            base.resolved.deadline,
            base.resolved.latestStart,
            zone,
            opened,
          ).map((iso) => ({ iso, label: closesShort(iso, zone) }))}
          repliesPicked={card.resolved.deadline}
          onTimeOfDay={chooseTimeOfDay}
          onDuration={chooseDuration}
          onReplies={chooseReplies}
          onDone={() => setSheet(false)}
          onMore={() => {
            setSheet(false);
            clearTimeout(pending.current);
            void editLatest((latest) => ({ answer: answerOf(latest, { days: picked }) })).then(() =>
              router.push('/circles/new/plan/setup'),
            );
          }}
        />
      }
    />
  );
}
