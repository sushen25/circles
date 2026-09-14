import { z } from 'zod';

import { IdempotencyKey, RequestId } from '../ids.js';

/**
 * The envelope every Edge Function shares (architecture §7.4, §9.1).
 *
 * Bodies here are deliberately thin: this ticket fixes the names, the shapes
 * and the fact that both sides validate. The functions themselves land in
 * Slice 1, and each will grow its own request as it does.
 */

/** Every mutation is safe to retry, keyed by the client. */
export const Mutation = z.object({ idempotency_key: IdempotencyKey });

/**
 * At least two, because "a meetup of one is not a meetup" — the same floor
 * `quorumDefault` applies and `plans_quorum` enforces.
 *
 * Declared here rather than as a bare positive integer because the boundary is
 * where a `1` should be refused: sent onward it trips a check constraint, whose
 * SQLSTATE has no reason to map to, so an ordinary invalid request came back as
 * a 500.
 */
export const Quorum = z.int().min(2);
export type Quorum = z.infer<typeof Quorum>;

/**
 * Why a request failed, precisely — the cause a *screen* turns on.
 *
 * `Problem.error` below is the category that picks the HTTP status, and it is
 * deliberately coarse: four different refusals are all `conflict`. But a client
 * has a different screen for an invite that has been rotated (LinkInvalid) than
 * for a name somebody else is already using (ask for another one), and "decide
 * by parsing the message" is how a copy edit becomes a broken branch.
 *
 * So: the category decides the status, the reason decides the screen. Every
 * function documents the reasons it can return; later tickets add their own.
 */
export const ProblemReason = z.enum([
  /** `redeem-invite`: no live invite has that secret — rotated, or never issued. */
  'invite_inactive',
  /** `redeem-invite`: the circle holds the maximum active members (ADR 0012). */
  'circle_full',
  /** `redeem-invite`: somebody active in the circle already uses that name. */
  'duplicate_name',
  /** `reattach-member`: no active guest membership answers to that id or token. */
  'member_not_found',
  /** `reattach-member`: the target has a saved place, so it signs in instead. */
  'target_is_permanent',
  /** `reattach-member`: so does the caller. */
  'caller_is_permanent',
  /** `reattach-member`: the caller is already in this circle under their own name. */
  'already_member',
  /** `reattach-member`: three moves in seven days is the limit (ADR 0006). */
  'reattach_limit',
  /** `reattach-member`: the re-entry token is unknown, spent or expired. */
  'token_invalid',
  /** `claim-identity`: the session being merged from is not an anonymous one. */
  'source_is_permanent',
  /** `claim-identity`: the caller has not signed in, so there is no place to save. */
  'destination_is_not_permanent',
  /** `redeem-invite`: the name is empty, or too long, once whitespace is collapsed. */
  'display_name_unusable',
  /** Any mutation: this idempotency key was used for a different body. */
  'idempotency_mismatch',
  /** Any mutation: the first attempt with this key has not finished yet. */
  'in_progress',
  /** Any endpoint: an abuse limit, not an authorisation decision. Retry later. */
  'too_many_requests',

  // S1-15, the plan lifecycle.

  /** `create-circle`, `create-plan`: creating needs a saved place (ADR 0004). The InitiateGate. */
  'requires_saved_place',
  /** `create-plan`: quiet asks land in S2-02. Not a refusal of this person, of this feature. */
  'not_yet',
  /** `create-circle`: handing out the way in is the owner's alone (spec §5.2). */
  'not_the_owner',
  /** `revise-plan`: only the organiser edits. */
  'not_the_organiser',
  /**
   * `cancel-plan`: a quiet ask is withdrawn by whoever started it (spec §5.4).
   * Nobody else, and the plan says nothing about who that is (§14).
   */
  'not_the_initiator',
  /** `cancel-plan`: the organiser or the circle's owner, and nobody else (spec §4.5). */
  'not_the_organiser_or_owner',
  /** The plan is over — completed, expired or already cancelled. */
  'plan_is_finished',
  /** The plan is in a state this action does not exist from (e.g. reopening one never confirmed). */
  'wrong_state',
  'plan_not_found',
  'circle_not_found',
  /** An archived circle stops all prompts (spec §5.2), and a new plan is the loudest. */
  'circle_archived',

  // What the domain says about a window it cannot resolve. Each is a screen:
  // "too late for tonight" offers tomorrow, "window has passed" re-opens the
  // picker. They are the domain's own error names, unchanged, so that a reader
  // can find the rule that produced one.
  'too_late_for_tonight',
  'window_too_long',
  'window_backwards',
  'window_has_passed',
  'band_shorter_than_meetup',
  'band_backwards',
  'band_unaligned',
  'band_out_of_day',
  /** A chosen deadline after the last possible start, or already past (spec §5.3). */
  'deadline_out_of_range',
  /**
   * `cancel-plan`: a quiet ask withdrawn before threshold is "closed privately,
   * nobody told" (spec §9), so its note would have no reader and `plans` is
   * readable by the whole circle. Every other cancellation takes one.
   */
  'note_not_allowed',
  /**
   * `revise-plan`: the plan moved between the preview and the save, so the cost
   * the organiser was shown is no longer the cost. Fetch the preview again.
   */
  'preview_is_stale',
  /**
   * `revise-plan`: every value in the request is the value the plan already has.
   * Saving it would emit "the plan changed" and, for a quorum, throw away a
   * candidate set — over a form resubmitted unedited.
   */
  'nothing_to_change',
  // S1-18. Asking for email, and stopping it.

  /**
   * `verify-email-contact`, `manage-email-preferences`: the link is spent,
   * expired, or was never one of ours. One reason for all three: telling them
   * apart would say whether a token *existed*, and the screen's answer is the
   * same either way — ask for a new one.
   */
  'link_expired',
  /**
   * A re-entry link was asked for on a circle this person is not in, or before
   * they have a verified address to send it to. Never reached by a client
   * today: S1-19's templates call it, and a reason beats a SQLSTATE when they do.
   */
  'not_a_member',
  'no_verified_contact',

  // S1-17, the confirmation and the outcome.

  /**
   * `confirm-meetup`: the candidate set the organiser was looking at is not the
   * one the plan has now — somebody answered, or the plan was edited. The times
   * on the screen may no longer be on offer, so the client refetches and shows
   * what is. Never a silent substitution: confirming "the top option" from a set
   * that has moved is how a person locks in a time they did not choose.
   */
  'stale_candidates',
  /**
   * `confirm-meetup`: that time is not one of the options. A set that is current
   * and an id that is not in it — a client holding a stale screen gets
   * `stale_candidates` instead.
   */
  'needs_candidate',
  /** `confirm-meetup`: the time has passed while the review screen was open. */
  'candidate_has_passed',
  /**
   * `confirm-meetup`: the survey on the review screen was not answered. Two taps
   * (spec §5.10), required by the endpoint *and* by the RPC behind it — the
   * evidence for H2 is not optional because of the door somebody came through.
   */
  'chased_answer_required',
  /** `report-outcome`: an outcome has been reported, and a different one cannot replace it. */
  'outcome_already_reported',
  /** `report-outcome`: "I was there" before the meetup has ended is not an early answer. */
  'attendance_too_early',
  /**
   * `report-outcome`: an answer about the past cannot become a promise about the
   * future — `was_there` does not go back to `going`.
   */
  'attendance_not_reversible',
  /** `report-outcome`, `generate-ics`: no such confirmation, or not one of yours. */
  'confirmation_not_found',
  /**
   * `report-outcome`: the confirmation has been superseded or cancelled — the
   * evening being reported on is not the one that is live.
   */
  'confirmation_not_active',
  /** `report-outcome`: the plan has moved to a revision this confirmation is not of. */
  'stale_confirmation',
  /** `report-outcome`: "did it happen?" before it has finished happening. */
  'outcome_too_early',
  /** `report-outcome`: the confirmation an attendance names is not there. */
  'attendance_confirmation_missing',
  /** `report-outcome`: attendance on a confirmation that is no longer live. */
  'attendance_confirmation_not_live',
  /** `report-outcome`: this plan was never asked of you, so there is nothing to attend. */
  'attendance_not_a_participant',

  /**
   * `submit-availability`: the plan has moved to a later revision, so this
   * answer is to a question that is no longer being asked. Fetch the plan again
   * and answer the new one — the windows are about different dates now.
   */
  'stale_revision',
  /**
   * `submit-availability`: the deadline has passed or the plan has been
   * confirmed. "Editing is allowed until confirmation or the deadline" (§5.5).
   */
  'replies_closed',
  /**
   * `submit-availability`: a `windows` answer with no windows, or any other
   * status carrying some. The union in `packages/domain` has this shape for a
   * reason — switching somebody to "not this time" without clearing the array
   * would store availability they had just withdrawn.
   */
  'windows_do_not_match_status',
  /**
   * `submit-availability`: a window on a date the plan never mentions. Not a
   * stray tap, which is dropped — a caller and a plan disagreeing about what
   * was asked.
   */
  'outside_plan_window',
  /** `submit-availability`: a window that ends before it starts. */
  'not_a_window',
  /**
   * `revise-plan`: somebody named as required was never asked. Joining an active
   * plan is an opt-in (spec §9), so a member who joined the circle afterwards is
   * not a participant and cannot answer — requiring them would strand the plan.
   */
  'not_a_participant',
]);
export type ProblemReason = z.infer<typeof ProblemReason>;

/**
 * The error shape. `reference` is the short string a person can read back to
 * us ("Ref 7F3K-2Q") — it identifies the request, never the person.
 */
export const Problem = z.object({
  error: z.enum([
    'unauthorised',
    'forbidden',
    'not_found',
    'conflict',
    'expired',
    'rate_limited',
    'invalid_request',
    'unavailable',
  ]),
  /**
   * The precise cause, when there is one a client can act on. Absent for
   * failures with nothing to say beyond the category.
   */
  reason: ProblemReason.optional(),
  /** Plain language, safe to show. Never contains anyone's data. */
  message: z.string(),
  reference: RequestId,
});
export type Problem = z.infer<typeof Problem>;

/** Accepted, with nothing to say beyond that it worked. */
export const Accepted = z.object({ ok: z.literal(true) });
export type Accepted = z.infer<typeof Accepted>;
