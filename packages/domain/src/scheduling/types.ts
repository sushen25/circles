/**
 * The candidate engine's vocabulary (architecture §12, spec §5.6).
 *
 * This is the product's one piece of real computation, and the whole design
 * follows from four words in the spec: **deterministic, explainable, fast,
 * versioned**. It runs unchanged on the client for an instant preview and in
 * `recalculate-candidates` as the authority, so the same inputs must give the
 * same answer in both — no clocks read inside, no iteration order that depends
 * on how a Map was built, no floating point.
 */

import type { UserId } from '../circles/types.js';
import type { ResponseStatus } from '../availability/types.js';
import type { Instant } from '../shared/instant.js';
import type { Interval } from '../shared/interval.js';
import type { LocalDate } from '../shared/local-date.js';
import type { Zone } from '../shared/zone.js';

/** Bumped whenever the algorithm changes; stored with every set (§12). */
export const SCORING_VERSION = 1;

/**
 * What the engine needs about the plan. A subset of `Plan` rather than the
 * aggregate itself, so a caller can preview a plan that does not exist yet —
 * which is exactly what the setup screen does.
 */
export type EnginePlan = {
  readonly window: { readonly start: LocalDate; readonly end: LocalDate };
  readonly daily: { readonly startMin: number; readonly endMin: number };
  readonly zone: Zone;
  readonly durationMinutes: number;
  readonly quorum: number;
  readonly requiredMemberIds: readonly UserId[];
};

export type MemberResponse = {
  readonly status: ResponseStatus;
  readonly windows: readonly Interval[];
};

export type EngineInput = {
  readonly plan: EnginePlan;
  /**
   * Answers by member. An array of entries rather than a `Map`, because a Map's
   * iteration order is its insertion order — the engine would then give
   * different answers for the same set of responses depending on the order the
   * caller happened to read them from the database.
   */
  readonly responses: readonly (readonly [UserId, MemberResponse])[];
  readonly activeMemberIds: readonly UserId[];
  readonly now: Instant;
};

/**
 * Why an option is being shown, given the ones above it. The copy package turns
 * these into the sentences on the artboards — "Best attendance", "One fewer,
 * weekend", "Also four, a day later" — and no sentence lives here (§5.4).
 */
export type ExplanationCode =
  | 'best_attendance'
  | 'same_attendance_weekend'
  | 'same_attendance_sooner'
  | 'same_attendance_later'
  | 'one_fewer_weekend'
  | 'one_fewer_sooner'
  | 'one_fewer_later'
  | 'also_n_sooner'
  | 'also_n_later'
  /** The first near-miss, when nothing was eligible. */
  | 'closest';

export type Explanation = {
  readonly code: ExplanationCode;
  /** The available count, for `also_n_later` — "Also **four**, a day later". */
  readonly count: number;
};

export type Candidate = {
  readonly start: Instant;
  readonly end: Instant;
  /**
   * Sorted by the order in `activeMemberIds`, so the same set always renders in
   * the same order. Never contains a non-responder (§5.6: dashed marks are for
   * people who have not answered, and they are never inside "can make it").
   */
  readonly availableUserIds: readonly UserId[];
  readonly explicitCount: number;
  readonly flexibleCount: number;
  readonly explanation: Explanation;
};

/** Why an otherwise-good time is not offered. One rule, not a list (§5.6). */
export type NearMissReason =
  | { readonly kind: 'quorum_short'; readonly by: number }
  | { readonly kind: 'required_missing'; readonly userId: UserId };

export type NearMiss = {
  readonly start: Instant;
  readonly end: Instant;
  readonly availableUserIds: readonly UserId[];
  /**
   * Split the same way a candidate's is. A near-miss is rendered by the same
   * card as an option — "Closest: Tuesday, 3 of 6" — and the server stores both
   * in one table, where the counts have to add up to the list beside them. They
   * were missing here only because nothing had yet stored one.
   */
  readonly explicitCount: number;
  readonly flexibleCount: number;
  readonly reason: NearMissReason;
  readonly explanation: Explanation;
};

export type EngineStats = {
  readonly startsConsidered: number;
  readonly eligibleCount: number;
  readonly respondedCount: number;
  readonly activeMemberCount: number;
};

export type CandidateSet = {
  readonly scoringVersion: number;
  /**
   * A stable digest of the input, so the server can tell whether a result it is
   * about to store was computed from the plan as it is now. Change detection,
   * not security — see `inputHash`.
   */
  readonly inputHash: string;
  /** At most three, ranked, with date diversity (§12 step 5). */
  readonly eligible: readonly Candidate[];
  /** Populated only when nothing is eligible. At most three. */
  readonly nearMisses: readonly NearMiss[];
  readonly stats: EngineStats;
};
