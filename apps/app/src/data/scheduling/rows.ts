import {
  ANSWERABLE_STATES,
  type DurationMinutes,
  type ExplanationCode,
  type NearMissReason,
  type PlanState,
  type UserId,
  lastPossibleStart,
  localDate,
  toISO,
  zone,
} from '@circles/domain';

/**
 * A stored option, as a screen reads it (spec §5.6).
 *
 * Candidates and near-misses are the same table, told apart by `is_near_miss`
 * and ranked separately (S1-16). What this file holds is everything about one
 * row that is not a query: its shape, the codes and reasons this build knows
 * how to read, and which of the four states a set of them puts the plan in.
 */

export type SchedulingView = 'ready' | 'no_quorum' | 'collecting' | 'closed';

export type CandidateRow = {
  /**
   * The candidate's id **is its start instant** as ISO, not the row id:
   * `confirm-meetup` takes it that way and it survives a recalculation, which
   * a row id would not (S1-16).
   */
  id: string;
  startsAt: string;
  endsAt: string;
  rank: number;
  /**
   * In the plan's audience order, and never a non-responder — the dashed marks
   * are people who have not answered and are never inside "can make it" (§5.6).
   */
  availableUserIds: string[];
  /** `null` when the database holds a code this build does not know. */
  explanationCode: ExplanationCode | null;
  explanationCount: number;
  /** One rule, not a list. Only ever set on a near-miss. */
  nearMissReason: NearMissReason | null;
};

/**
 * Codes this build knows. Written as an exhaustive record rather than a list,
 * so that a code added to the engine fails to compile here instead of arriving
 * on a screen with no sentence for it.
 */
const KNOWN_CODES: Record<ExplanationCode, true> = {
  best_attendance: true,
  same_attendance_weekend: true,
  same_attendance_sooner: true,
  same_attendance_later: true,
  one_fewer_weekend: true,
  one_fewer_sooner: true,
  one_fewer_later: true,
  also_n_sooner: true,
  also_n_later: true,
  closest: true,
};

export function codeOf(value: string): ExplanationCode | null {
  return Object.hasOwn(KNOWN_CODES, value) ? (value as ExplanationCode) : null;
}

/** The stored reason, or `null` for anything this build cannot read. */
export function reasonOf(value: unknown): NearMissReason | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'quorum_short') {
    const by = (value as { by?: unknown }).by;
    return typeof by === 'number' ? { kind: 'quorum_short', by } : null;
  }
  if (kind === 'required_missing') {
    const userId = (value as { userId?: unknown }).userId;
    // The engine's own branded id; the database stores it as a plain uuid.
    return typeof userId === 'string'
      ? { kind: 'required_missing', userId: userId as unknown as UserId }
      : null;
  }
  return null;
}

/** Which of the four states the plan is in, from the rows a screen will show. */
export function viewOf(
  state: PlanState,
  candidates: readonly CandidateRow[],
  nearMisses: readonly CandidateRow[],
): SchedulingView {
  if (!ANSWERABLE_STATES.includes(state)) return 'closed';
  if (candidates.length > 0) return 'ready';
  if (nearMisses.length > 0) return 'no_quorum';
  return 'collecting';
}

/**
 * A plan whose time is locked in — confirmed, or confirmed and then reported
 * on. Its page is the confirmed screen, not the options (S1-28).
 */
export function isLockedIn(state: PlanState): boolean {
  return state === 'confirmed' || state === 'completed';
}

/**
 * The latest the meetup could still begin, from the plan row: the domain's
 * `lastPossibleStart`, which the database's `plan_last_possible_start` mirrors.
 * It bounds every deadline, and so "give it one more day" (spec §5.7).
 */
export function latestStartOf(plan: {
  window_start: string;
  window_end: string;
  daily_start_local: number;
  daily_end_local: number;
  duration_minutes: number;
  time_zone: string;
}): string {
  return toISO(
    lastPossibleStart({
      window: { start: localDate(plan.window_start), end: localDate(plan.window_end) },
      daily: { startMin: plan.daily_start_local, endMin: plan.daily_end_local },
      durationMinutes: plan.duration_minutes as DurationMinutes,
      zone: zone(plan.time_zone),
    }),
  );
}
