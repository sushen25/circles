import { fromISO, isNudgeMoment, type NudgeRecord } from '@circles/domain';

/**
 * A `nudge_states` row as `nudgeEligibility` reads it. One copy, for the two
 * readers: `record-nudge`, which runs the caps, and the client, which credits
 * a new circle to "Start a circle" (S2-07).
 */
export const NUDGE_STATE_COLUMNS = 'moment, plan_id, shown_at, answer, answered_at';

export interface NudgeStateRow {
  moment: string;
  plan_id: string | null;
  shown_at: string;
  answer: string | null;
  answered_at: string | null;
}

/**
 * Undefined for a moment this build does not know: a row written by a newer
 * one cannot be reasoned about, so it is left out rather than guessed at.
 */
export function nudgeRecordOf(row: NudgeStateRow): NudgeRecord | undefined {
  if (!isNudgeMoment(row.moment)) return undefined;
  return {
    moment: row.moment,
    planId: row.plan_id,
    shownAt: fromISO(row.shown_at),
    answer: row.answer === 'dismissed' || row.answer === 'tapped' ? row.answer : null,
    answeredAt: row.answered_at === null ? null : fromISO(row.answered_at),
  };
}
