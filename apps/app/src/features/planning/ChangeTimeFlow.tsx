import { addDays, fromISO, localDate, toLocal, zone as toZone } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { PlanDetails } from '../../data/planning';
import { dateWords } from '../availability/days';
import { isOffline } from '../identity/join/failure';
import { weekdayOf } from '../scheduling/words';
import { allows } from './allowed';
import { ChangeTimeScreen } from './ChangeTimeScreen';
import { CustomWindowScreen } from './CustomWindowScreen';
import { editDraftFrom, resolveEdit } from './edit';
import type { PlanDraft } from './form';
import * as fixture from './fixtures';
import { DeadlineSheet } from './sheets';
import { usePlanDetails } from './usePlanDetails';
import { usePlanForm, type FormContext } from './usePlanForm';
import { useRevision } from './useRevision';
import { whenWords } from './when';

/**
 * `/circles/:id/plan/:planId/change-time` — "Change the time" from the
 * confirmed screen (spec §5.7). The organiser picks a new window; the save is
 * `revise-plan { reopen: true }`, previewed first like any edit, and then the
 * organiser is handed the "Change of plan" message to paste.
 */
const OFFERED = ['next_7_days', 'next_14_days', 'custom'];
const ROLLING: Record<string, number | undefined> = { next_7_days: 7, next_14_days: 14 };

/** The day after the one being taken off the table, in the circle's zone. */
function afterDay(startsAt: string, zone: string): string {
  return addDays(toLocal(fromISO(startsAt), toZone(zone)).date, 1);
}

/**
 * "Next 7 days" from the day after the old time rather than from today, when
 * that is later: the same length, none of it on the day that is off.
 */
export function fromDay(draft: PlanDraft, after: string, today: string): PlanDraft {
  const days = ROLLING[draft.preset];
  if (days === undefined || after <= today) return draft;
  return {
    ...draft,
    preset: 'custom',
    custom: { start: after, end: addDays(localDate(after), days - 1) },
  };
}

export function ChangeTimeFlow({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const query = usePlanDetails({ planId });
  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/circles/[id]/plan/[planId]/confirmed',
          params: { id, planId },
        });

  if (!hasBackend()) {
    return (
      <ChangeForm plan={fixture.lockedIn} now={fixture.FIXTURE_NOW} onDone={back} onBack={back} />
    );
  }
  if (query.isPending) return <ChangeTimeScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <ChangeTimeScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  const plan = query.data;
  if (plan === null) return <ChangeTimeScreen state="denied" onBack={back} />;
  if (!plan.isOrganiser) {
    return (
      <ChangeTimeScreen
        statement={{ title: t('planSetup', 'problem_not_organiser'), body: '' }}
        onBack={back}
      />
    );
  }
  if (!allows(plan.state, 'reopen') || plan.lastConfirmation?.status !== 'active') {
    return (
      <ChangeTimeScreen
        statement={{
          title: t('changeTime', 'not_locked_in_title'),
          body: t('changeTime', 'not_locked_in_body'),
        }}
        onBack={back}
      />
    );
  }
  return (
    <LiveChangeForm
      plan={plan}
      onDone={() =>
        router.replace({
          pathname: '/circles/[id]/plan/[planId]/shared',
          params: { id: plan.circleId, planId, again: '1' },
        })
      }
      onBack={back}
    />
  );
}

function LiveChangeForm(props: { plan: PlanDetails; onDone: () => void; onBack: () => void }) {
  const [openedAt] = useState(() => Date.now());
  return <ChangeForm {...props} now={openedAt} live />;
}

function ChangeForm({
  plan: opened,
  now,
  live = false,
  onDone,
  onBack,
}: {
  plan: PlanDetails;
  now: number;
  live?: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  // The plan as the screen opened on it, for the reason EditPlan gives: a
  // refetch on focus must not turn an untouched quorum into a change.
  const [plan] = useState(opened);
  const instant = fromISO(new Date(now).toISOString());
  const startsAt = plan.lastConfirmation!.startsAt;
  // The new window starts after the day it takes off the table, so what the
  // members are told — "Thursday is off the table" — stays true of every time
  // they can be offered (spec §5.7).
  const after = afterDay(startsAt, plan.zone);
  const today = toLocal(instant, toZone(plan.zone)).date;
  const context: FormContext = {
    zone: plan.zone,
    people: [],
    me: plan.me,
    members: plan.participants.length,
    quorumShown: plan.quorum,
    quorumFollows: false,
    notBefore: after,
  };
  // A new window, with its own hours: the artboard's fortnight by default.
  const [initial] = useState(() => ({
    ...editDraftFrom(plan),
    preset: 'next_14_days' as const,
    custom: undefined,
    band: undefined,
  }));
  const resolveReopen = (draft: PlanDraft) =>
    resolveEdit(plan, fromDay(draft, after, today), instant, {
      reopen: true,
      deadlinePreset: draft.preset,
    });
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    resolve: resolveReopen,
    closesDetail: (resolved) => whenWords(resolved.deadline, plan.zone),
  });
  const resolved = resolveReopen(form.draft);
  const saving = useRevision({
    planId: plan.planId,
    circleId: plan.circleId,
    revision: resolved.ok ? resolved.revision : undefined,
    enabled: live,
    event: 'plan_rescheduled',
    onSaved: onDone,
  });
  const when = form.controls.when
    .filter((chip) => OFFERED.includes(chip.key))
    .map((chip) => {
      const days = ROLLING[chip.key];
      return days === undefined || after <= today
        ? chip
        : {
            ...chip,
            label: t('changeTime', 'days_from', {
              count: days,
              date: dateWords(localDate(after), 'short'),
            }),
          };
    });

  if (form.step === 'window') return <CustomWindowScreen {...form.window} />;

  const day = weekdayOf(plan.lastConfirmation!.startsAt, plan.zone);
  return (
    <ChangeTimeScreen
      day={day}
      when={when}
      closes={form.controls.closes}
      problem={form.problem}
      refused={saving.refused?.message}
      reference={saving.refused?.reference}
      busy={saving.busy}
      canAsk={resolved.ok && saving.preview !== undefined}
      onNext={saving.save}
      onKeep={onBack}
      onBack={onBack}
      sheets={form.deadlineSheet === undefined ? null : <DeadlineSheet {...form.deadlineSheet} />}
    />
  );
}
