import { type Instant, addMinutes, isBefore } from '../shared/instant.js';

/**
 * A first plan nobody has answered (SUS-240, parts 3 and 4): when the organiser
 * is asked what happened, and when one letter offers a hand.
 *
 * One rule, here, so the waiting screen that asks, the dispatcher that writes
 * and the tests that pin them say the same thing: the circle's **first** named
 * plan, still asking, with **no answer from anyone but its organiser**, 48 hours
 * after it was made. The clock is the plan's creation and not the share: the
 * database knows when a plan was made, and only an event, which can be lost,
 * knows when it was shared (the founder view's stalled-first-plans read counts
 * from the share, because it reads events anyway).
 */
export const FIRST_PLAN_QUIET_HOURS = 48;

export type FirstPlanQuietFacts = {
  readonly createdAt: Instant;
  readonly now: Instant;
  /** People other than the organiser who have answered the plan, on any revision. */
  readonly othersAnswered: number;
  /** The circle's first named plan: the one a stranger's path is measured by. */
  readonly isFirstPlan: boolean;
  /** Collecting or ready: a plan that was decided or called off has not stalled. */
  readonly stillAsking: boolean;
};

/** Whether this plan is a first plan that has had nothing from anyone for 48 hours. */
export function firstPlanQuiet(facts: FirstPlanQuietFacts): boolean {
  if (!facts.isFirstPlan || !facts.stillAsking || facts.othersAnswered > 0) return false;
  return !isBefore(facts.now, addMinutes(facts.createdAt, FIRST_PLAN_QUIET_HOURS * 60));
}

/**
 * Whether the founder's "want a hand?" letter is owed: the plan has gone quiet
 * and this circle has never been sent it. Once per circle, ever, so a second
 * stalled plan in the same circle sends nothing (ADR 0085).
 */
export function firstPlanQuietLetterDue(
  facts: FirstPlanQuietFacts & { readonly alreadySent: boolean },
): boolean {
  return !facts.alreadySent && firstPlanQuiet(facts);
}
