import type { CircleId } from '@circles/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { deviceTimeZone, guard, ownProfile, useSession } from '../../data/auth';
import { createCircle, keepInviteSecret } from '../../data/circles';
import { clearDraft, readDraft, saveDraft } from '../../data/draft';
import { createFirstPlan } from '../../data/planning';
import { failureOf } from '../identity/join/failure';
import { WINDOW_EVENT } from '../planning/form';
import { FinishDraftScreen, type FinishDraftProblem } from './FinishDraftScreen';

/**
 * `/circles/new/finish` — where the drafted circle and plan are made (ADR 0053).
 *
 * Reached with a saved place and a name: from the gate once the code is through
 * (and Your name, for an account that has none), or straight from the plan card
 * for somebody who was already signed in. It calls `create-circle`, then
 * `create-plan`, once each, and clears the draft only after both have answered.
 *
 * **Safe to run twice.** The two idempotency keys were made with the draft, so
 * a reload in the middle, or a tap on Try again after a timeout, returns the
 * circle and the plan the first run made (ADR 0016). `create-circle` and
 * `create-plan` are not touched: an anonymous session is still refused by the
 * first, and the circle is still the member's own.
 *
 * Nothing here decides who may organise. A session that is not a saved place
 * goes back to the gate; the server's `requires_saved_place` is read the same
 * way.
 */
const REASONS: Record<string, FinishDraftProblem> = {
  too_many_requests: 'too_many_tries',
};

export function FinishDraftFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const decision = guard({ route: 'saved', session });

  const [circleName, setCircleName] = useState('');
  const [problem, setProblem] = useState<FinishDraftProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (decision.kind === 'wait' || running.current) return;
    running.current = true;
    setProblem(undefined);
    setReference(undefined);

    const run = async () => {
      const draft = await readDraft();
      if (draft === null || draft.way === undefined) {
        router.replace('/circles/new');
        return;
      }
      setCircleName(draft.circleName);
      if (decision.kind !== 'allow') {
        router.replace('/circles/new/save');
        return;
      }
      if (!draft.proceed) await saveDraft({ proceed: true });

      const profile = await ownProfile();
      if (profile === null || profile.name === null) {
        router.replace('/name');
        return;
      }

      const made = await createCircle({
        name: draft.circleName,
        cadence: draft.cadence,
        timeZone: profile.zone ?? deviceTimeZone() ?? 'UTC',
        idempotencyKey: draft.keys.circle,
      });
      keepInviteSecret(made.circle.id, made.invite_secret);
      track('circle_created', { circle_id: made.circle.id });

      if (draft.way === 'invite') {
        await clearDraft();
        router.replace({ pathname: '/circles/[id]/invite', params: { id: made.circle.id } });
        return;
      }

      const circleId = made.circle.id as CircleId;
      const plan = await createFirstPlan({
        circleId,
        title: t('firstPlan', 'plan_title'),
        preset: draft.preset,
        idempotencyKey: draft.keys.plan,
      });
      track('plan_created', {
        circle_id: circleId,
        plan_id: plan.plan_id,
        mode: 'named',
        window: WINDOW_EVENT[draft.preset],
        used_defaults: draft.preset === 'next_14_days',
      });
      void queryClient.invalidateQueries({ queryKey: ['circle-home', circleId] });
      await clearDraft();
      router.replace({
        pathname: '/circles/[id]/plan/[planId]/shared',
        params: { id: circleId, planId: plan.plan_id },
      });
    };

    run()
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (failure.kind === 'reason' && failure.reason === 'requires_saved_place') {
          // The session stopped being a saved place underneath the screen.
          router.replace('/circles/new/save');
        } else if (failure.kind === 'offline') {
          setProblem('offline');
        } else if (failure.kind === 'reason' && REASONS[failure.reason] !== undefined) {
          setProblem(REASONS[failure.reason]);
        } else {
          setProblem('couldnt_set_up');
          setReference(failure.reference);
        }
      })
      .finally(() => {
        running.current = false;
      });
    // `attempt` is the Try again button: another run of the same effect.
  }, [decision.kind, attempt, router, queryClient]);

  return (
    <FinishDraftScreen
      circleName={circleName}
      problem={problem}
      reference={reference}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}
