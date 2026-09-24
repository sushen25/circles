/**
 * The confirmation context: the moment a plan becomes a real thing in people's
 * evenings (spec §5.7, §5.10).
 *
 * Four rules carry the whole context, and they are the ones architecture §6.2
 * names: one active confirmation per revision, **frozen** on confirm, superseded
 * rather than mutated on reschedule, and `happened` is the only outcome that
 * moves the circle's `lastMetAt`.
 *
 * "Frozen" is why `Confirmation` copies the candidate's start, end and available
 * set instead of pointing at one. A late reply changes the candidate set; it
 * must not change a time people have already put in their calendars, and a
 * reference would let it.
 */

import type { CircleId, UserId } from '../circles/types.js';
import type { PlanId } from '../planning/types.js';
import type { CandidateSet } from '../scheduling/types.js';
import type { Instant } from '../shared/instant.js';

export type ConfirmationId = string & { readonly __brand: 'ConfirmationId' };

export function confirmationId(value: string): ConfirmationId {
  if (value.length === 0) throw new RangeError('Empty confirmation id');
  return value as ConfirmationId;
}

/**
 * A candidate's identity **is its start instant**.
 *
 * The engine is deterministic, so recalculating a plan's candidates yields the
 * same starts; keying on the start means the id the organiser is holding on the
 * review screen still points at the same time after a recalculation, which an
 * opaque row id would not. It is also the only key the client, the Edge Function
 * and the database can all derive without agreeing on a generator.
 *
 * ISO rather than the raw number so it is readable in a log and safe in a URL.
 */
export type CandidateId = string & { readonly __brand: 'CandidateId' };

/**
 * A stored candidate set, as the database holds it: the plan and revision it was
 * computed for, beside the set itself.
 *
 * `CandidateSet` deliberately does not carry them — `EnginePlan` has no id so
 * that the setup screen can preview a plan that does not exist yet — so the
 * pairing lives here, where staleness is actually checked.
 */
export type PlanCandidates = {
  readonly planId: PlanId;
  readonly revision: number;
  /**
   * The plan's `inputVersion` when this set was generated — `candidate_sets` is
   * unique on `(plan_id, revision, input_version)` (architecture §8.2).
   *
   * Read from the stored row, never recomputed here: comparing it against the
   * plan's current version is the freshness check `confirm-meetup` owes (§9.1),
   * and a value derived from the set itself would compare equal to itself.
   */
  readonly inputVersion: number;
  readonly set: CandidateSet;
};

/** A frozen copy of the candidate, not a reference to one. */
export type ConfirmedCandidate = {
  readonly start: Instant;
  readonly end: Instant;
  /** Who could make it **when it was locked in**. Later replies do not change it. */
  readonly availableUserIds: readonly UserId[];
};

/**
 * `superseded` is a reschedule — "Thursday is off the table", a new revision
 * asking again. `cancelled` is a decision to stop. `completed` is an outcome
 * having been reported. Only one confirmation per revision is ever `active`,
 * and that is the database's constraint as well as this type's intent.
 */
export type ConfirmationStatus = 'active' | 'superseded' | 'cancelled' | 'completed';

export const NOTE_MAX_LENGTH = 280;

export type Confirmation = {
  readonly id: ConfirmationId;
  readonly planId: PlanId;
  readonly revision: number;
  readonly candidate: ConfirmedCandidate;
  readonly placeName?: string | undefined;
  /** An address or map link. Never a link carrying a token — see `isSafeLink`. */
  readonly placeUrl?: string | undefined;
  readonly note?: string | undefined;
  readonly confirmedBy: UserId;
  readonly status: ConfirmationStatus;
  readonly confirmedAt: Instant;
};

/**
 * What a member says about one confirmation.
 *
 * The five are two questions, not one. `going` / `cant` / `unknown` are before
 * the meetup — "Going / Can't make it / To confirm", correctable at any time
 * (§5.7). `was_there` / `missed` are after it, and answer the different
 * question the WasThere screen asks. A status never goes back from an answer
 * about the past to a promise about the future.
 */
export type AttendanceStatus = 'going' | 'cant' | 'unknown' | 'was_there' | 'missed';

/** The subset a member may choose. `unknown` is derived, never chosen. */
export type AttendanceChoice = Exclude<AttendanceStatus, 'unknown'>;

export type Attendance = {
  readonly confirmationId: ConfirmationId;
  readonly userId: UserId;
  readonly status: AttendanceStatus;
  readonly updatedAt: Instant;
};

/**
 * "Did this catch-up happen?" (spec §5.10). Four answers, and `moved_outside`
 * is the honest one the product needs most: it is neither failure nor success,
 * and it is the evidence for H2.
 */
export const OUTCOMES = ['happened', 'cancelled', 'moved_outside', 'not_sure'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Whether anyone but the reporter says it happened (spec §5.10). Not a score
 * and never shown as one: it exists so the metric can tell an organiser's
 * report from a corroborated one.
 */
export type Corroboration = 'reported' | 'corroborated';

export type OutcomeReport = {
  readonly confirmationId: ConfirmationId;
  readonly circleId: CircleId;
  readonly outcome: Outcome;
  readonly reportedBy: UserId;
  /** "A line for the circle's record, optional" — the same 280 as the note. */
  readonly note?: string | undefined;
  readonly reportedAt: Instant;
};
