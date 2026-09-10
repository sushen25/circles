/**
 * Locking a time in, and letting go of one (spec §5.7).
 *
 * "Times are frozen once locked. Later replies won't move it." — the
 * ConfirmReview screen says that to the organiser, and this module is where it
 * has to be true. `confirm` copies the candidate; nothing here holds a
 * reference to a candidate set that a later recalculation can change underneath
 * it.
 *
 * Whether the organiser is *allowed* to confirm is not re-decided here. That
 * lives in the plan state machine, which the SQL mirror is generated from
 * (architecture §8.3), and asking it is how the client, this module and
 * `planning.transition_plan()` stay unable to disagree.
 */

import type { UserId } from '../circles/types.js';
import { type Actor, type TransitionError, canTransition } from '../planning/state-machine.js';
import type { Plan, PlanId } from '../planning/types.js';
import type { Candidate } from '../scheduling/types.js';
import { SCORING_VERSION } from '../scheduling/types.js';
import { type Instant, toISO } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import {
  type CandidateId,
  type Confirmation,
  type ConfirmationId,
  NOTE_MAX_LENGTH,
  type PlanCandidates,
} from './types.js';

/** A place name is a line on a card, not a paragraph. */
export const PLACE_NAME_MAX_LENGTH = 120;

/** See `CandidateId`: a candidate is identified by the instant it starts. */
export function candidateIdOf(candidate: { readonly start: Instant }): CandidateId {
  return toISO(candidate.start) as CandidateId;
}

export type ConfirmationDetails = {
  readonly placeName?: string | undefined;
  readonly placeUrl?: string | undefined;
  readonly note?: string | undefined;
};

/**
 * Every way confirming can be refused.
 *
 * The first seven are the state machine's own codes, passed through unchanged
 * so that client, server and SQL name the same refusal. The rest are this
 * module's: they are about the candidate set and the details, which the state
 * machine cannot see.
 *
 * Like `TransitionError`, no message — wording is presentation (§5.4).
 */
export type ConfirmErrorCode =
  | TransitionError['code']
  | 'wrong_plan'
  | 'stale_candidates'
  | 'stale_input_version'
  | 'stale_scoring_version'
  | 'candidate_not_eligible'
  | 'candidate_has_passed'
  | 'note_too_long'
  | 'place_name_too_long'
  | 'place_url_not_a_link';

export type ConfirmError = {
  readonly code: ConfirmErrorCode;
  readonly planId: PlanId;
  /** The plan's revision, which is what a `stale_candidates` caller has to catch up to. */
  readonly revision: number;
};

export type ConfirmRequest = {
  readonly plan: Plan;
  /** The stored set, with the plan and revision it was computed for. */
  readonly candidates: PlanCandidates;
  readonly candidateId: CandidateId;
  readonly details: ConfirmationDetails;
  readonly actor: Actor;
  readonly now: Instant;
  /**
   * Minted by the caller. A pure function cannot generate an id — randomness
   * would make the same input give two answers, which is the one thing the
   * domain may never do.
   */
  readonly confirmationId: ConfirmationId;
};

export type Confirmed = {
  readonly confirmation: Confirmation;
  /** The plan in its `confirmed` state, from the state machine. */
  readonly plan: Plan;
};

/**
 * An address or a map link, and nothing exotic.
 *
 * `http` and `https` only: `javascript:` and `data:` are the reason this check
 * exists at all, and a relative string is not a link the confirmed screen can
 * open. Query strings are allowed — a map link is mostly query string.
 */
export function isLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function detailProblem(details: ConfirmationDetails): ConfirmErrorCode | undefined {
  if ((details.note?.length ?? 0) > NOTE_MAX_LENGTH) return 'note_too_long';
  if ((details.placeName?.length ?? 0) > PLACE_NAME_MAX_LENGTH) return 'place_name_too_long';
  if (details.placeUrl !== undefined && !isLink(details.placeUrl)) return 'place_url_not_a_link';
  return undefined;
}

export function confirm(request: ConfirmRequest): Result<ConfirmError, Confirmed> {
  const { plan, candidates, candidateId, details, actor, now } = request;
  const fail = (code: ConfirmErrorCode): Result<ConfirmError, Confirmed> =>
    err({ code, planId: plan.id, revision: plan.revision });

  // Whether this move is allowed at all, including that the id is one of the
  // times actually on offer. Fails closed on an unknown id (`needs_candidate`).
  const transition = canTransition(plan, 'confirm', {
    actor,
    candidateId,
    eligibleCandidateIds: candidates.set.eligible.map(candidateIdOf),
  });
  if (!transition.ok) return fail(transition.error.code);

  // The set has to be this plan's, this revision's, this input's and this
  // engine's. A candidate computed before an edit is a time somebody was never
  // asked about; one computed before a withdrawn reply names people who are no
  // longer free, and freezing it would put them on a card saying they are
  // coming. Recalculation is asynchronous (§9.1), so this window is real rather
  // than theoretical.
  if (candidates.planId !== plan.id) return fail('wrong_plan');
  if (candidates.revision !== plan.revision) return fail('stale_candidates');
  if (candidates.inputVersion !== plan.inputVersion) return fail('stale_input_version');
  if (candidates.set.scoringVersion !== SCORING_VERSION) return fail('stale_scoring_version');

  const candidate = candidates.set.eligible.find((c) => candidateIdOf(c) === candidateId);
  if (candidate === undefined) return fail('candidate_not_eligible');
  // A candidate that begins in the past is removed on recalculation (spec §9),
  // and confirming one in the meantime would lock in a time that has gone.
  if (candidate.start <= now) return fail('candidate_has_passed');

  const problem = detailProblem(details);
  if (problem !== undefined) return fail(problem);

  return ok({
    confirmation: freeze(request, candidate),
    plan: transition.value,
  });
}

function freeze(request: ConfirmRequest, candidate: Candidate): Confirmation {
  const { plan, details, actor, now, confirmationId } = request;
  return {
    id: confirmationId,
    planId: plan.id,
    revision: plan.revision,
    candidate: {
      start: candidate.start,
      end: candidate.end,
      // Copied, not shared. `readonly` stops *this* package writing through the
      // reference; it does nothing about the caller who still holds the array,
      // and "frozen" has to survive a caller who reuses their candidate set.
      availableUserIds: [...candidate.availableUserIds],
    },
    placeName: details.placeName,
    placeUrl: details.placeUrl,
    note: details.note,
    confirmedBy: actor.userId as UserId,
    status: 'active',
    confirmedAt: now,
  };
}

/**
 * "Change the time" and "Cancel this plan", from the confirmation's side.
 *
 * Both **supersede rather than mutate** (architecture §6.2). The row keeps the
 * time it held, because "Thursday is off the table" is a thing that has to stay
 * true in the record after Thursday stops being the plan — the ChangeTime
 * screen promises everyone will see exactly that.
 */
export type SupersedeReason = 'reopen' | 'cancel';

export type SupersedeError = {
  readonly code: 'confirmation_not_active';
  readonly confirmationId: ConfirmationId;
  readonly status: Confirmation['status'];
};

export function supersede(
  confirmation: Confirmation,
  reason: SupersedeReason,
): Result<SupersedeError, Confirmation> {
  if (confirmation.status !== 'active') {
    return err({
      code: 'confirmation_not_active',
      confirmationId: confirmation.id,
      status: confirmation.status,
    });
  }
  return ok({ ...confirmation, status: reason === 'reopen' ? 'superseded' : 'cancelled' });
}

/**
 * The active confirmation for one revision of one plan, if there is one. At
 * most one exists — that is the context's rule and the database's constraint.
 *
 * The plan is part of the key, not context the caller can be trusted to have
 * applied: every plan starts at revision 1, so a list spanning two plans would
 * otherwise hand back the wrong meetup's confirmation.
 */
export function activeConfirmation(
  confirmations: readonly Confirmation[],
  planId: PlanId,
  revision: number,
): Confirmation | undefined {
  return confirmations.find(
    (c) => c.planId === planId && c.revision === revision && c.status === 'active',
  );
}

/** Who was frozen into the confirmation as able to make it. */
export function confirmedAttendees(confirmation: Confirmation): readonly UserId[] {
  return confirmation.candidate.availableUserIds;
}
