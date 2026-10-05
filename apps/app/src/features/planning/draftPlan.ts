import { fromISO, type Instant } from '@circles/domain';

import { DEFAULT_PLAN, type DraftPlan } from '../../data/draft';
import { firstPlanCardWords, type FirstPlanCardWords } from './firstPlanCard';
import { resolveDraft, type PlanDraft, type Resolved } from './form';

/**
 * The plan drafted before there is a circle (ADR 0053), between the device's
 * record (`data/draft`) and the plan form (`form.ts`).
 *
 * The draft holds exactly what the form's `PlanDraft` holds, less the two things
 * a circle of one has no answer to — a quorum and the people who must come — so
 * these are two renamings and a way of reading the draft as the card says it.
 * Nothing here decides what a plan means: `resolveDraft` does, as it does for a
 * plan made in a circle that exists.
 */
export function formOf(plan: DraftPlan): PlanDraft {
  return {
    category: plan.category,
    preset: plan.preset,
    custom:
      plan.custom === undefined
        ? undefined
        : {
            start: plan.custom.start,
            end: plan.custom.end,
            ...(plan.custom.days === undefined ? {} : { days: [...plan.custom.days] }),
          },
    band: plan.band,
    duration: plan.duration,
    // Nobody to count and nobody to require yet: the server's own, which stays
    // the placeholder that follows the circle as people join (ADR 0026).
    quorum: undefined,
    required: undefined,
    deadline: plan.deadline,
  };
}

export function planOf(form: PlanDraft): DraftPlan {
  return {
    category: form.category,
    preset: form.preset,
    ...(form.custom === undefined || form.preset !== 'custom'
      ? {}
      : {
          custom: {
            start: form.custom.start,
            end: form.custom.end,
            ...(form.custom.days === undefined ? {} : { days: [...form.custom.days] }),
          },
        }),
    ...(form.band === undefined ? {} : { band: { ...form.band } }),
    duration: form.duration,
    ...(form.deadline === undefined ? {} : { deadline: form.deadline }),
  };
}

/** Nothing but the fortnight, two hours and the defaults: `plan_created.used_defaults`. */
export function isUntouched(plan: DraftPlan): boolean {
  return (
    plan.category === DEFAULT_PLAN.category &&
    plan.preset === DEFAULT_PLAN.preset &&
    plan.duration === DEFAULT_PLAN.duration &&
    plan.band === undefined &&
    plan.deadline === undefined
  );
}

export type DraftCard = {
  /** The plan as it will be made: the draft, or what it falls back to. */
  plan: DraftPlan;
  resolved: Extract<Resolved, { ok: true }>;
  words: FirstPlanCardWords;
};

/**
 * The plan as the card shows it, worked out in `zone` for a plan made `now`.
 *
 * A draft outlives the moment it was drawn in: Tonight can run out, a deadline
 * can pass. Rather than offer a card that would be refused, a chosen deadline
 * that no longer holds is dropped (the preset's own takes over), and a window
 * that has gone falls back to the fortnight with everything else kept.
 */
export function draftCard(plan: DraftPlan, zone: string, openedAt: number): DraftCard {
  const now: Instant = fromISO(new Date(openedAt).toISOString());
  const withoutDeadline: DraftPlan = { ...plan };
  delete withoutDeadline.deadline;
  const fortnight: DraftPlan = { ...withoutDeadline, preset: 'next_14_days' };
  delete fortnight.custom;
  const attempts = [plan, ...(plan.deadline === undefined ? [] : [withoutDeadline]), fortnight];
  for (const attempt of attempts) {
    const resolved = resolveDraft(formOf(attempt), now, zone);
    if (resolved.ok)
      return { plan: attempt, resolved, words: wordsOf(attempt, resolved, zone, openedAt) };
  }
  // The fortnight in the default hours always resolves; reached only by a band
  // that cannot hold the meetup, which the setup refuses to save.
  const base: DraftPlan = { ...DEFAULT_PLAN, category: plan.category };
  const resolved = resolveDraft(formOf(base), now, zone);
  if (!resolved.ok) throw new Error('the default plan does not resolve');
  return { plan: base, resolved, words: wordsOf(base, resolved, zone, openedAt) };
}

function wordsOf(
  plan: DraftPlan,
  resolved: Extract<Resolved, { ok: true }>,
  zone: string,
  openedAt: number,
): FirstPlanCardWords {
  return firstPlanCardWords(
    {
      band: resolved.band,
      durationMinutes: plan.duration,
      deadline: resolved.deadline,
      latestStart: resolved.latestStart,
    },
    plan.preset,
    zone,
    openedAt,
    { category: plan.category, custom: formOf(plan).custom },
  );
}
