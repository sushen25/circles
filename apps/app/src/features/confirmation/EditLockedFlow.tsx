import type { Instant } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { ConfirmationRead } from '../../data/confirmation';
import type { PlanCandidates } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { clockNow, usePlanClock } from '../planning/clock';
import * as scheduling from '../scheduling/fixtures';
import { useCandidates } from '../scheduling/useCandidates';
import { dateOf, timeOf, weekdayOf } from '../scheduling/words';
import { EditLockedScreen } from './EditLockedScreen';
import { detailsChanged, editNoticeOf } from './editLocked';
import { fixtureStretch } from './fixtureStretch';
import * as fixture from './fixtures';
import { fieldsOf, type ReviewForm } from './review';
import { stretchWords } from './stretch';
import { isoOf, pickOf, problemOf as timeProblemOf, type TimePick } from './time';
import { useConfirmation } from './useConfirmation';
import { useEditLocked } from './useEditLocked';
import { useStretch } from './useStretch';

/**
 * `/circles/:id/plan/:planId/edit-locked?start&end` — the organiser edits a
 * locked-in plan (ADR 0050): its time, its place and its note.
 *
 * Change opens the same time picker as "Pick a different time"; choosing a time
 * there comes back here with `start` and `end`, and the place and note typed
 * here are kept, because this screen never unmounted. Saving a new time moves the
 * plan in the same revision and asks nobody for their times again; saving only the
 * place or note changes nobody's status and emails nobody.
 */
export function EditLockedFlow({
  id,
  planId,
  start,
  end,
}: {
  id: string;
  planId: string;
  start?: string | undefined;
  end?: string | undefined;
}) {
  return hasBackend() ? (
    <LiveEdit id={id} planId={planId} start={start} end={end} />
  ) : (
    <FixtureEdit start={start} end={end} />
  );
}

function FixtureEdit({ start, end }: { start?: string | undefined; end?: string | undefined }) {
  const router = useRouter();
  const data = fixture.lockedInOwnTime;
  return (
    <Edit
      plan={scheduling.ready}
      confirmation={data.confirmation!}
      start={start}
      end={end}
      live={false}
      planId={data.planId}
      busy={false}
      problem={undefined}
      onChangeTime={() => router.push('/circles/sunday-crew/plan/thu-17/set-time?mode=edit')}
      onSave={() => router.back()}
      onBack={() => router.back()}
    />
  );
}

function LiveEdit({
  id,
  planId,
  start,
  end,
}: {
  id: string;
  planId: string;
  start?: string | undefined;
  end?: string | undefined;
}) {
  const router = useRouter();
  const confirmed = useConfirmation({ planId });
  const planQuery = useCandidates({ planId });
  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/circles/[id]/plan/[planId]/confirmed',
          params: { id, planId },
        });
  const toConfirmed = () =>
    router.dismissTo({ pathname: '/circles/[id]/plan/[planId]/confirmed', params: { id, planId } });
  const save = useEditLocked({ planId, onSaved: toConfirmed });

  if (confirmed.isPending || planQuery.isPending) {
    return <EditLockedScreen state="loading" onBack={back} />;
  }
  if (confirmed.isError || planQuery.isError) {
    return (
      <EditLockedScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void confirmed.refetch();
          void planQuery.refetch();
        }}
        onBack={back}
      />
    );
  }
  const plan = planQuery.data ?? undefined;
  const read = confirmed.data ?? undefined;
  if (plan === undefined || read === undefined)
    return <EditLockedScreen state="denied" onBack={back} />;
  if (!plan.isOrganiser) return <EditLockedScreen state="denied" onBack={back} />;
  // Not locked in, or over: nothing to edit.
  if (read.view !== 'confirmed' || read.confirmation === null) {
    return <EditLockedScreen state="expired" onBack={back} />;
  }

  return (
    <Edit
      plan={plan}
      confirmation={read.confirmation}
      start={start}
      end={end}
      live
      planId={planId}
      busy={save.busy}
      problem={save.problem}
      onChangeTime={(range) =>
        router.push({
          pathname: '/circles/[id]/plan/[planId]/set-time',
          params: { id, planId, mode: 'edit', start: range.startsAt, end: range.endsAt },
        })
      }
      onSave={(input) =>
        save.save({ ...input, circleId: plan.circleId, invitedCount: plan.askedCount })
      }
      onBack={back}
    />
  );
}

type Saved = {
  startsAt: string | undefined;
  endsAt: string | undefined;
  expectedInputVersion: number | undefined;
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
};

function Edit({
  plan,
  confirmation,
  start,
  end,
  live,
  planId,
  busy,
  problem,
  onChangeTime,
  onSave,
  onBack,
}: {
  plan: PlanCandidates;
  confirmation: ConfirmationRead;
  start: string | undefined;
  end: string | undefined;
  live: boolean;
  planId: string;
  busy: boolean;
  problem: string | undefined;
  onChangeTime: (range: { startsAt: string; endsAt: string }) => void;
  onSave: (input: Saved) => void;
  onBack: () => void;
}) {
  const [clock] = usePlanClock(clockNow, true);
  const [form, setForm] = useState<ReviewForm>({
    placeName: confirmation.placeName ?? '',
    placeUrl: confirmation.placeUrl ?? '',
    note: confirmation.note ?? '',
  });

  // The time the plan will have: the one the picker brought back, or the one it has.
  const current = { startsAt: confirmation.startsAt, endsAt: confirmation.endsAt };
  const next =
    start !== undefined && end !== undefined ? { startsAt: start, endsAt: end } : current;
  const moved = next.startsAt !== current.startsAt || next.endsAt !== current.endsAt;
  const pick: TimePick = pickOf(next.startsAt, next.endsAt, plan.zone);
  const valid = !moved || timeProblemOf(plan, pick, clock as Instant) === undefined;

  const asked = useStretch(planId, isoOf(pick, plan.zone), live && moved && valid);
  const stretch = !moved
    ? undefined
    : live
      ? asked.data
      : fixtureStretch(next.startsAt, next.endsAt);
  const words = stretch === undefined ? undefined : stretchWords(plan, stretch, pick);

  const fields = fieldsOf(form);
  const changed = detailsChanged(fields, confirmation);
  const canSave = fields.valid && valid && (moved ? stretch !== undefined : changed);

  const previousDay = weekdayOf(current.startsAt, plan.zone);
  return (
    <EditLockedScreen
      date={dateOf(next.startsAt, plan.zone)}
      time={timeOf(next.startsAt, next.endsAt, plan.zone)}
      moved={moved}
      whoLine={words === undefined ? undefined : `${words.count} · ${words.line}`}
      placeName={form.placeName}
      placeUrl={form.placeUrl}
      placeUrlError={fields.placeUrlError}
      note={form.note}
      noteCount={fields.noteCount}
      notice={editNoticeOf({
        moved,
        previousWeekday: previousDay,
        asked: words === undefined ? [] : words.notGoing,
      })}
      keepLabel={t('editLocked', 'keep', { weekday: previousDay })}
      problem={problem ?? (moved && !valid ? t('editLocked', 'gone') : undefined)}
      busy={busy}
      canSave={canSave}
      onChangeTime={() => onChangeTime(moved ? next : current)}
      onPlaceName={(placeName) => setForm({ ...form, placeName })}
      onPlaceUrl={(placeUrl) => setForm({ ...form, placeUrl })}
      onNote={(note) => setForm({ ...form, note })}
      onSave={() =>
        onSave({
          startsAt: moved ? isoOf(pick, plan.zone).startsAt : undefined,
          endsAt: moved ? isoOf(pick, plan.zone).endsAt : undefined,
          expectedInputVersion: moved ? stretch?.inputVersion : undefined,
          placeName: fields.placeName,
          placeUrl: fields.placeUrl,
          note: fields.note,
        })
      }
      onKeep={onBack}
      onBack={onBack}
    />
  );
}
