import { fromISO } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { PlanDetails } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { weekdayOf } from '../scheduling/words';
import { ChangeTimeScreen } from './ChangeTimeScreen';
import { CustomWindowScreen } from './CustomWindowScreen';
import { editDraftFrom, resolveEdit } from './edit';
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
  if (plan.state !== 'confirmed' || plan.lastConfirmation?.status !== 'active') {
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
  plan,
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
  const instant = fromISO(new Date(now).toISOString());
  const context: FormContext = {
    zone: plan.zone,
    people: [],
    me: plan.me,
    members: plan.participants.length,
    quorumShown: plan.quorum,
    quorumFollows: false,
  };
  // A new window, with its own hours: the artboard's fortnight by default.
  const [initial] = useState(() => ({
    ...editDraftFrom(plan),
    preset: 'next_14_days' as const,
    custom: undefined,
    band: undefined,
  }));
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    resolve: (draft) => resolveEdit(plan, draft, instant, { reopen: true }),
    closesDetail: (resolved) => whenWords(resolved.deadline, plan.zone),
  });
  const resolved = resolveEdit(plan, form.draft, instant, { reopen: true });
  const saving = useRevision({
    planId: plan.planId,
    circleId: plan.circleId,
    revision: resolved.ok ? resolved.revision : undefined,
    enabled: live,
    event: 'plan_rescheduled',
    onSaved: onDone,
  });

  if (form.step === 'window') return <CustomWindowScreen {...form.window} />;

  const day = weekdayOf(plan.lastConfirmation!.startsAt, plan.zone);
  return (
    <ChangeTimeScreen
      day={day}
      when={form.controls.when.filter((chip) => OFFERED.includes(chip.key))}
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
