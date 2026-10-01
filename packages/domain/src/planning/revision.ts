/**
 * What an edit costs (spec §5.3).
 *
 * "An edit that invalidates responses creates a new revision, clears the
 * affected responses and shows, **before saving**, exactly who will be asked
 * again." The point is that the organiser sees the cost before paying it —
 * asking six people to redo their availability is a real imposition, and one
 * they should make knowingly.
 */

import type { UserId } from '../circles/types.js';
import type { LocalDate } from '../shared/local-date.js';
import { askedDays, daysChange } from './days.js';
import type { DailyWindow, PlanTiming } from './types.js';

/**
 * Changes that alter *what was asked*. Quorum and deadline change what happens
 * to the answers, not the question, so they cost nobody a second reply.
 */
export type InvalidatingChange = 'window' | 'daily' | 'duration';

function sameDaily(a: DailyWindow, b: DailyWindow): boolean {
  return a.startMin === b.startMin && a.endMin === b.endMin;
}

/**
 * What about the question changed.
 *
 * The days are the one change that can be free (ADR 00ZZ): taking away days
 * that nobody picked leaves every answer meaning what it meant, so it is not a
 * new question. `picked` is the days somebody's answer has times on, which
 * only the server can see; without it, any change to the days counts, which
 * is the cautious answer.
 */
export function invalidatingChanges(
  before: PlanTiming,
  after: PlanTiming,
  picked?: readonly LocalDate[],
): readonly InvalidatingChange[] {
  const changes: InvalidatingChange[] = [];
  const days = daysChange(before.window, after.window, picked ?? askedDays(before.window));
  if (days === 'reask') changes.push('window');
  if (!sameDaily(before.daily, after.daily)) changes.push('daily');
  if (before.durationMinutes !== after.durationMinutes) changes.push('duration');
  return changes;
}

/**
 * Whether an edit takes days away without asking anybody again: the window's
 * days changed, and the change is a `narrow` (ADR 00ZZ). `revise_plan` makes it
 * without a new revision.
 */
export function narrowsDays(
  before: PlanTiming,
  after: PlanTiming,
  picked: readonly LocalDate[],
): boolean {
  return daysChange(before.window, after.window, picked) === 'narrow';
}

export type ReAskPlan = {
  /** Answered already, and must answer again because the question changed. */
  readonly askedAgain: readonly UserId[];
  /** Never answered; they get the same fresh ask they would have had anyway. */
  readonly freshAsk: readonly UserId[];
  readonly changes: readonly InvalidatingChange[];
  readonly bumpsRevision: boolean;
};

/**
 * Who has to be asked again if this edit is saved.
 *
 * Members who had not yet answered are listed separately: the warning copy
 * distinguishes them ("…will be asked again, and Alex gets a fresh ask")
 * because being asked twice is a different imposition from being asked once.
 */
export function invalidatedResponses(
  before: PlanTiming,
  after: PlanTiming,
  members: readonly UserId[],
  responded: readonly UserId[],
  /**
   * A change that invalidates every answer without changing the timing.
   *
   * Reopening a confirmed plan is the one: "Thursday is off the table" and "a
   * fresh ask" (spec §5.7) — the question is the same question, and everybody
   * answers it again because the plan they answered about has been unpicked.
   * The timing comparison cannot see that, so the caller says so, and the
   * caller is the state machine's `bumpsRevision` rather than an opinion:
   * `reopen` carries it, `adjust` does not.
   *
   * Without this, a reopen reported nobody in either list while clearing every
   * response — the organiser told the change cost nothing, and six people asked
   * again anyway.
   */
  alsoInvalidating = false,
  /** The days somebody picked, when the caller knows (`invalidatingChanges`). */
  picked?: readonly LocalDate[],
): ReAskPlan {
  const changes = invalidatingChanges(before, after, picked);
  const hasResponded = (id: UserId): boolean => responded.includes(id);

  if (changes.length === 0 && !alsoInvalidating) {
    return { askedAgain: [], freshAsk: [], changes, bumpsRevision: false };
  }

  return {
    askedAgain: members.filter(hasResponded),
    freshAsk: members.filter((id) => !hasResponded(id)),
    changes,
    bumpsRevision: true,
  };
}

/**
 * "Priya, Tom and Jess" — an Oxford-comma-free list in the product's voice.
 * Returns the names, joined; the sentence around them is copy, and lives in
 * `apps/app/src/copy`.
 */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1] ?? ''}`;
}
