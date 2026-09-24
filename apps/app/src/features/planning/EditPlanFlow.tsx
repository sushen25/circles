import { fromISO, isTerminal } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { PlanDetails } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { CustomWindowScreen } from './CustomWindowScreen';
import { changesSomething, editDraftFrom, namesWithYou, resolveEdit } from './edit';
import { EditPlanScreen } from './EditPlanScreen';
import * as fixture from './fixtures';
import { DeadlineSheet, RequiredSheet } from './sheets';
import { usePlanDetails } from './usePlanDetails';
import { usePlanForm, type FormContext } from './usePlanForm';
import { useRevision } from './useRevision';
import { whenWords } from './when';
import { reaskWarning } from './words';

/**
 * `/circles/:id/plan/:planId/edit` — the organiser changes a plan that is
 * still asking (spec §5.3). The waiting screen's "Edit the plan" and the
 * no-quorum screen's "Change who has to be there" come here.
 *
 * Only the organiser edits, and only while the plan is collecting or ready:
 * a locked-in plan is moved with "Change the time", which is a different
 * transition with a different message (§5.7). Both are said on the screen
 * rather than offered and refused.
 */
export function EditPlanFlow({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const query = usePlanDetails({ planId });

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/circles/[id]/plan/[planId]/candidates',
          params: { id, planId },
        });

  if (!hasBackend()) {
    return <EditForm plan={fixture.asking} now={fixture.FIXTURE_NOW} onDone={back} onBack={back} />;
  }
  if (query.isPending) return <EditPlanScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <EditPlanScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  const plan = query.data;
  if (plan === null) return <EditPlanScreen state="denied" onBack={back} />;
  if (!plan.isOrganiser) {
    return (
      <EditPlanScreen
        statement={{
          title: t('editPlan', 'not_yours_title'),
          body: t('editPlan', 'not_yours_body'),
        }}
        onBack={back}
      />
    );
  }
  if (plan.state === 'confirmed') {
    return (
      <EditPlanScreen
        statement={{
          title: t('editPlan', 'locked_title'),
          body: t('editPlan', 'locked_body'),
          action: t('editPlan', 'see_the_plan'),
          onAction: () =>
            router.replace({
              pathname: '/circles/[id]/plan/[planId]/confirmed',
              params: { id: plan.circleId, planId },
            }),
        }}
        onBack={back}
      />
    );
  }
  if (plan.state !== 'collecting' && plan.state !== 'ready') {
    return (
      <EditPlanScreen
        statement={{
          title: isTerminal(plan.state)
            ? t('planSetup', 'problem_finished')
            : t('planSetup', 'problem_wrong_state'),
          body: '',
        }}
        onBack={back}
      />
    );
  }

  return (
    <LiveEditForm
      plan={plan}
      onDone={(asksAgain) =>
        asksAgain
          ? router.replace({
              pathname: '/circles/[id]/plan/[planId]/shared',
              params: { id: plan.circleId, planId, again: '1' },
            })
          : back()
      }
      onBack={back}
    />
  );
}

function LiveEditForm(props: {
  plan: PlanDetails;
  onDone: (asksAgain: boolean) => void;
  onBack: () => void;
}) {
  // The moment the screen was opened, for the same reason as the setup's.
  const [openedAt] = useState(() => Date.now());
  return <EditForm {...props} now={openedAt} live />;
}

function EditForm({
  plan,
  now,
  live = false,
  onDone,
  onBack,
}: {
  plan: PlanDetails;
  now: number;
  live?: boolean;
  onDone: (asksAgain: boolean) => void;
  onBack: () => void;
}) {
  const instant = fromISO(new Date(now).toISOString());
  const names = new Map(plan.roster.map((m) => [m.userId, m.name]));
  const active = new Set(plan.roster.filter((m) => m.active).map((m) => m.userId));
  // Only the people this revision asks can be required (`not_a_participant`) —
  // and anybody still required who has left, so they can be taken off: that is
  // what "Change who has to be there" is for (spec §9, S1-27).
  const gone = plan.required.filter((id) => !plan.participants.includes(id));
  const context: FormContext = {
    zone: plan.zone,
    people: [...plan.participants, ...gone].map((userId) => {
      const name = names.get(userId) ?? t('planSetup', 'someone');
      return {
        id: userId,
        name: active.has(userId) ? name : t('planSetup', 'left_the_circle', { name }),
      };
    }),
    me: plan.me,
    members: plan.participants.length,
    quorumShown: plan.quorum,
    quorumFollows: false,
    kept: { window: { start: plan.windowStart, end: plan.windowEnd }, band: plan.band },
  };
  const [initial] = useState(() => editDraftFrom(plan));
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    resolve: (draft) => resolveEdit(plan, draft, instant),
    closesDetail: (resolved, draft) => {
      const at = whenWords(resolved.deadline, plan.zone);
      if (fromISO(resolved.deadline) === fromISO(plan.responseDeadline)) {
        return t('editPlan', 'closes_unchanged', { deadline: at });
      }
      return draft.deadline === undefined ? t('editPlan', 'closes_moved', { deadline: at }) : at;
    },
  });

  const resolved = resolveEdit(plan, form.draft, instant);
  const revision =
    resolved.ok && changesSomething(resolved.revision) ? resolved.revision : undefined;
  const saving = useRevision({
    planId: plan.planId,
    circleId: plan.circleId,
    revision,
    enabled: live,
    onSaved: (answer) => onDone(answer.bumps_revision),
  });

  if (form.step === 'window') return <CustomWindowScreen {...form.window} />;

  const words = { you: t('planSetup', 'you'), someone: t('planSetup', 'someone') };
  const preview = saving.preview;
  const warning =
    preview === undefined
      ? undefined
      : preview.bumps_revision
        ? {
            text: reaskWarning(
              namesWithYou(plan, preview.asked_again, words),
              namesWithYou(plan, preview.fresh_ask, words),
            ),
            asksAgain: true,
          }
        : { text: t('editPlan', 'no_reask'), asksAgain: false };

  return (
    <EditPlanScreen
      title={plan.title}
      controls={form.controls}
      problem={form.problem}
      warning={revision === undefined ? undefined : warning}
      checking={saving.checking}
      refused={saving.refused?.message}
      reference={saving.refused?.reference}
      busy={saving.busy}
      canSave={revision !== undefined && preview !== undefined}
      onNext={saving.save}
      onKeepThePlanAs={onBack}
      onBack={onBack}
      sheets={
        <>
          {form.deadlineSheet === undefined ? null : <DeadlineSheet {...form.deadlineSheet} />}
          <RequiredSheet {...form.requiredSheet} />
        </>
      }
    />
  );
}
