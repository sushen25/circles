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
import type { DailyWindow, DateWindow, PlanTiming } from './types.js';

/**
 * Changes that alter *what was asked*. Quorum and deadline change what happens
 * to the answers, not the question, so they cost nobody a second reply.
 */
export type InvalidatingChange = 'window' | 'daily' | 'duration';

function sameWindow(a: DateWindow, b: DateWindow): boolean {
  return a.start === b.start && a.end === b.end;
}

function sameDaily(a: DailyWindow, b: DailyWindow): boolean {
  return a.startMin === b.startMin && a.endMin === b.endMin;
}

export function invalidatingChanges(
  before: PlanTiming,
  after: PlanTiming,
): readonly InvalidatingChange[] {
  const changes: InvalidatingChange[] = [];
  if (!sameWindow(before.window, after.window)) changes.push('window');
  if (!sameDaily(before.daily, after.daily)) changes.push('daily');
  if (before.durationMinutes !== after.durationMinutes) changes.push('duration');
  return changes;
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
): ReAskPlan {
  const changes = invalidatingChanges(before, after);
  const hasResponded = (id: UserId): boolean => responded.includes(id);

  if (changes.length === 0) {
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
