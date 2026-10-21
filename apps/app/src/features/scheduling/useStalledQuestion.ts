import type { CircleId, FirstPlanStalledAnswer, PlanId } from '@circles/contracts';
import { firstPlanQuiet, fromISO, type Instant } from '@circles/domain';

import { useState } from 'react';

import { track } from '../../analytics/track';
import type { PlanCandidates } from '../../data/scheduling';
import { useNudge } from '../growth/useNudge';

/**
 * "Nothing in yet. What's happened?" (SUS-240): the one optional question on a
 * first plan's waiting screen, once the plan is 48 hours old and nobody but its
 * organiser has answered.
 *
 * The rule is the domain's (`firstPlanQuiet`); this only reads it off the plan.
 * It is asked of the organiser alone: a member never reaches the waiting
 * screen, and `enabled` is off for them besides. "Once" is `record-nudge`'s
 * `first_plan_stalled` row for this plan, which says the question was shown and
 * nothing about the answer; the answer is the `first_plan_stalled` event, one
 * of three words, and Skip records no event. Nothing waits on it (ADR 0061).
 */
export type StalledQuestion = {
  readonly onChoose: (answer: FirstPlanStalledAnswer) => void;
  readonly onSkip: () => void;
};

/** Whether this plan, read now, is a first plan that has gone quiet for its organiser. */
export function stalledDue(data: PlanCandidates | undefined, now: Instant): boolean {
  if (data === undefined || !data.isOrganiser || data.view !== 'collecting') return false;
  const answered = data.responded === null ? data.repliedCount : data.responded.length;
  // The organiser's own answer is not "anyone else's".
  const mine = data.me !== undefined && data.responded?.includes(data.me) === true ? 1 : 0;
  return firstPlanQuiet({
    createdAt: fromISO(data.createdAt),
    now,
    othersAnswered: data.othersAnsweredEver ? 1 : Math.max(0, answered - mine),
    isFirstPlan: data.isFirstPlan,
    stillAsking: data.state === 'collecting' || data.state === 'ready',
  });
}

/**
 * Which mount of the screen owns a plan's question once it has been shown.
 * `useNudge` lets an unanswered prompt come back on a later mount (right for the
 * prompts that want an answer); this one is shown once, so a screen mounted
 * again in the same session, having left without a tap, is not shown it.
 */
const owner = new Map<string, symbol>();

/** For tests: a new session. */
export function forgetStalledQuestions(): void {
  owner.clear();
}

export function useStalledQuestion(
  data: PlanCandidates | undefined,
  circleId: string,
  now: Instant,
): StalledQuestion | undefined {
  const due = stalledDue(data, now);
  const [mount] = useState(() => Symbol('stalled'));
  const nudge = useNudge('first_plan_stalled', { planId: data?.planId, enabled: due });
  if (data === undefined || !due || nudge.showing !== 'show' || nudge.answered !== undefined) {
    return undefined;
  }
  const holder = owner.get(data.planId);
  if (holder === undefined) owner.set(data.planId, mount);
  else if (holder !== mount) return undefined;
  return {
    onChoose: (answer) => {
      track('first_plan_stalled', {
        circle_id: circleId as CircleId,
        plan_id: data.planId as PlanId,
        answer,
      });
      nudge.tap();
    },
    // Nothing is recorded but that the question was put: the row says so.
    onSkip: nudge.dismiss,
  };
}
