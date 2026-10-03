import { fromISO, toLocal, zone as toZone, type Instant, type OthersSaid } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { othersSaid } from '../../data/availability';
import type { Stretch } from '../../data/confirmation';
import type { PlanCandidates } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { clockNow, usePlanClock } from '../planning/clock';
import { monthOf, shiftMonth } from '../planning/calendar';
import * as fixture from '../scheduling/fixtures';
import { useCandidates } from '../scheduling/useCandidates';
import { fixtureOthers, fixtureStretch } from './fixtureStretch';
import { SetTimeScreen } from './SetTimeScreen';
import { calendarOf, clockOf, optionAt, primaryLabelOf } from './setTime';
import { stretchWords } from './stretch';
import {
  existsOnClock,
  initialPick,
  isoOf,
  moveEnd,
  moveStart,
  onDay,
  problemOf,
  type TimePick,
} from './time';
import { useSettled, useStretch } from './useStretch';

/**
 * `/circles/:id/plan/:planId/set-time?mode=lock|edit&start&end` — the organiser
 * picks any day and time (ADR 0051).
 *
 * One flow behind "Pick a different time" on the options, "Set the time
 * yourself" on the waiting, no-quorum and replies-closed screens, and the edit
 * screen's Change. Which of them opened it is only where Back and the primary
 * lead: to the review (`lock`), or back to the edit screen with the new time
 * (`edit`). The names come from the database as the time changes and are never
 * worked out here.
 */
export type SetTimeMode = 'lock' | 'edit';

export function SetTimeFlow({
  id,
  planId,
  mode,
  start,
  end,
}: {
  id: string;
  planId: string;
  mode: SetTimeMode;
  start?: string | undefined;
  end?: string | undefined;
}) {
  return hasBackend() ? (
    <LiveSetTime id={id} planId={planId} mode={mode} start={start} end={end} />
  ) : (
    <FixtureSetTime mode={mode} />
  );
}

function FixtureSetTime({ mode }: { mode: SetTimeMode }) {
  const router = useRouter();
  const plan = fixture.ready;
  const now = fromISO('2026-09-10T00:00:00.000Z');
  return (
    <Picker
      plan={plan}
      planId={plan.planId}
      others={fixtureOthers}
      now={now}
      mode={mode}
      initial={undefined}
      live={false}
      onUse={() => router.push('/circles/sunday-crew/plan/thu-17/review')}
      onBack={() => router.back()}
    />
  );
}

function LiveSetTime({
  id,
  planId,
  mode,
  start,
  end,
}: {
  id: string;
  planId: string;
  mode: SetTimeMode;
  start: string | undefined;
  end: string | undefined;
}) {
  const router = useRouter();
  const query = useCandidates({ planId });
  const data = query.data ?? undefined;
  const [clock] = usePlanClock(clockNow, true);
  const others = useQuery({
    queryKey: ['others-said', planId, data?.revision],
    queryFn: async () => (await othersSaid(planId)) ?? null,
    enabled: data?.isOrganiser === true,
    staleTime: 30_000,
  });

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/circles/[id]/plan/[planId]/candidates',
          params: { id, planId },
        });

  if (query.isPending) return <SetTimeScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <SetTimeScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (data === undefined) return <SetTimeScreen state="denied" onBack={back} />;
  if (!data.isOrganiser) return <SetTimeScreen state="denied" onBack={back} />;
  // Where an organiser may set a time, and where they may move one.
  const open =
    mode === 'edit' ? data.state === 'confirmed' : ['collecting', 'ready'].includes(data.state);
  if (!open) return <SetTimeScreen state="expired" onBack={back} />;

  const chosen =
    start !== undefined && end !== undefined ? { startsAt: start, endsAt: end } : undefined;
  return (
    <Picker
      plan={data}
      planId={planId}
      others={others.data ?? undefined}
      now={clock as Instant}
      mode={mode}
      initial={chosen}
      live
      onUse={(pick) => {
        const { startsAt, endsAt } = isoOf(pick, data.zone);
        if (mode === 'edit') {
          router.navigate({
            pathname: '/circles/[id]/plan/[planId]/edit-locked',
            params: { id, planId, start: startsAt, end: endsAt },
          });
          return;
        }
        // Exactly one of the engine's options is locked in as one: as today.
        const option = optionAt(data, pick);
        router.push(
          option === undefined
            ? {
                pathname: '/circles/[id]/plan/[planId]/review',
                params: { id, planId, start: startsAt, end: endsAt },
              }
            : {
                pathname: '/circles/[id]/plan/[planId]/review',
                params: { id, planId, candidate: option },
              },
        );
      }}
      onBack={back}
    />
  );
}

type StretchRead = { data: Stretch | undefined; fetching: boolean; failed: boolean };

function Picker({
  plan,
  planId,
  others,
  now,
  mode,
  initial,
  live,
  onUse,
  onBack,
}: {
  plan: PlanCandidates;
  planId: string;
  others: OthersSaid | undefined;
  now: Instant;
  mode: SetTimeMode;
  initial: { startsAt: string; endsAt: string } | undefined;
  /** Reads who a time works for from the database; a build with no backend works it out here. */
  live: boolean;
  onUse: (pick: TimePick) => void;
  onBack: () => void;
}) {
  const [pick, setPick] = useState<TimePick>(() => initialPick(plan, now, initial));
  const [month, setMonth] = useState(() => monthOf(pick.day));
  const fromEdit = mode === 'edit';

  // The names follow the time once it has held still, and only for a time the
  // domain would accept: asking about the past is a question with no use.
  const settled = useSettled(pick);
  const exists = existsOnClock(pick, plan.zone);
  const valid = exists && problemOf(plan, settled, now) === undefined;
  const range = valid ? isoOf(settled, plan.zone) : undefined;
  const asked = useStretch(planId, range, live);
  const read: StretchRead = live
    ? { data: asked.data, fetching: asked.isFetching, failed: asked.isError }
    : {
        data: range === undefined ? undefined : fixtureStretch(range.startsAt, range.endsAt),
        fetching: false,
        failed: false,
      };
  const who = read.data === undefined ? undefined : stretchWords(plan, read.data, settled);
  const checking = settled !== pick || read.fetching;
  const problem = problemOf(plan, pick, now);

  const today = toLocal(now, toZone(plan.zone)).date;
  const title = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T12:00:00Z`));

  return (
    <SetTimeScreen
      backTitle={t('setTime', fromEdit ? 'back_to_plan' : 'back_to_options')}
      calendar={calendarOf({
        month,
        title,
        pick,
        plan,
        others,
        now,
        canEarlier: month > monthOf(today),
        onDay: (day) => setPick(onDay(pick, day as TimePick['day'])),
        onEarlier: () => setMonth((m) => (m > monthOf(today) ? shiftMonth(m, -1) : m)),
        onLater: () => setMonth((m) => shiftMonth(m, 1)),
      })}
      clock={clockOf(pick, plan, {
        start: (by) => setPick(moveStart(pick, by)),
        end: (by) => setPick(moveEnd(pick, by)),
      })}
      who={who}
      checking={checking && who !== undefined}
      problem={
        !exists
          ? t('setTime', 'no_such_time')
          : read.failed
            ? t('setTime', 'stretch_failed')
            : undefined
      }
      useLabel={primaryLabelOf(pick, plan, fromEdit)}
      canUse={exists && problem === undefined && read.data !== undefined && !checking}
      onUse={() => onUse(pick)}
      onBack={onBack}
    />
  );
}
