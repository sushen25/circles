/**
 * The plan context: one attempt by a circle to meet.
 *
 * The state machine here is the single source that `planning.transition_plan()`
 * mirrors in SQL (architecture §8.3). Nothing else writes `plans.state`, and
 * the client calls the same functions for immediate "can I do this?" answers,
 * so the two can never disagree about what is allowed.
 */

import type { Instant } from '../shared/instant.js';
import type { LocalDate } from '../shared/local-date.js';
import type { Zone } from '../shared/zone.js';
import type { CircleId, UserId } from '../circles/types.js';

export type PlanId = string & { readonly __brand: 'PlanId' };

export function planId(value: string): PlanId {
  if (value.length === 0) throw new RangeError('Empty plan id');
  return value as PlanId;
}

/** A named plan is announced; a quiet ask hides its initiator until a threshold. */
export type PlanMode = 'named' | 'quiet';

/**
 * `seeking` belongs only to a quiet ask, `draft` only to the moment before a
 * plan is written down. `expired` and `cancelled` are both terminal, and
 * distinct: expired is nobody's fault, cancelled is a decision.
 */
export type PlanState =
  | 'draft'
  | 'seeking'
  | 'collecting'
  | 'ready'
  | 'confirmed'
  | 'completed'
  | 'expired'
  | 'cancelled';

export const TERMINAL_STATES: readonly PlanState[] = ['completed', 'expired', 'cancelled'];

export function isTerminal(state: PlanState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Intent, in the spec's words. "Catch up" is the default and covers most plans. */
export type PlanCategory = 'catch_up' | 'dinner' | 'drinks' | 'coffee' | 'activity';

export type WindowPreset = 'tonight' | 'this_weekend' | 'next_7_days' | 'next_14_days' | 'custom';

/** Inclusive range of calendar days the plan may land on. */
export type DateWindow = {
  readonly start: LocalDate;
  readonly end: LocalDate;
};

/**
 * The hours of each day people are being asked about, as minutes since local
 * midnight. 17:30 is 1050. Not an `Interval`, which is absolute: this repeats
 * on every day of the window.
 */
export type DailyWindow = {
  readonly startMin: number;
  readonly endMin: number;
};

/** 60, 90, 120 or 180 minutes (spec §5.3). 120 is the circle's default default. */
export type DurationMinutes = 60 | 90 | 120 | 180;

export const DURATIONS: readonly DurationMinutes[] = [60, 90, 120, 180];

/** A window may span at most 14 consecutive days (spec §5.3). */
export const MAX_WINDOW_DAYS = 14;

export type Plan = {
  readonly id: PlanId;
  readonly circleId: CircleId;
  readonly mode: PlanMode;
  readonly state: PlanState;
  /** Absent on a quiet ask until someone accepts the role (architecture §6.2). */
  readonly organiserUserId?: UserId | undefined;
  readonly title: string;
  readonly category: PlanCategory;
  readonly zone: Zone;
  readonly window: DateWindow;
  readonly daily: DailyWindow;
  readonly durationMinutes: DurationMinutes;
  readonly quorum: number;
  /** Counted toward quorum. The organiser is required by default (spec §5.3). */
  readonly requiredMemberIds: readonly UserId[];
  readonly responseDeadline: Instant;
  readonly quietThreshold?: number | undefined;
  readonly quietExpiresAt?: Instant | undefined;
  /**
   * Bumped by an edit or a reopen. Responses belong to a revision, so an edit
   * that changes what was asked invalidates the answers rather than silently
   * reinterpreting them.
   */
  readonly revision: number;
  /**
   * Bumped every time an answer changes within the current revision
   * (architecture §9.1: `submit-availability` bumps it, `recalculate-candidates`
   * persists only if it is still current).
   *
   * A revision says the *question* changed; this says an *answer* did. Both
   * make a candidate set stale, and they are separate because only one of them
   * costs anybody a second reply.
   */
  readonly inputVersion: number;
  /** Which version of the candidate engine produced the current candidates. */
  readonly scoringVersion: number;
  /** The `/p/<code>` path segment. Carries no secret (architecture §5.2). */
  readonly shortCode: string;
};

export function isQuiet(plan: Plan): boolean {
  return plan.mode === 'quiet';
}

export function hasOrganiser(plan: Plan): boolean {
  return plan.organiserUserId !== undefined;
}
