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
  /** `revise-plan`, `cancel-plan`: only the organiser edits or cancels. */
  'not_the_organiser',
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
