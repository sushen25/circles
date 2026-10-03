import { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH, isLink } from '@circles/domain';
import { z } from 'zod';

import { CandidateSetId, ConfirmationId, PlanId, UserId } from '../ids.js';
import { Instant } from '../time.js';
import { Mutation } from './shared.js';

/**
 * `confirm-meetup` — the organiser locks a time in (spec §5.7).
 *
 * The candidate is named by **the instant it starts**, not by a row id. That is
 * the domain's `candidateIdOf` and the database's own comment on
 * `meetup_confirmations.candidate_id`: "the client's candidate id is the ISO
 * start". It has to be, because the set is recomputed whenever somebody answers
 * — a row id the organiser was holding would point at a row that no longer
 * exists, while the time they chose is still the time they chose.
 *
 * Everything else is what the review screen collects: a place, a note, and the
 * one survey question §5.10 asks there.
 *
 * **Or a day and time of the organiser's own** ([ADR 0051](../../../../docs/decisions/0051-the-organiser-sets-the-final-plan.md)):
 * the same endpoint, the same review screen, a different first half of the body.
 */
/**
 * What the review screen collects beside the time, whichever half of the body
 * names the time. Exported so the screen judges a field by the schema's own rule
 * instead of restating it.
 */
export const ConfirmDetails = {
  /** A line on a card, not a paragraph — the domain's limit, not a second one. */
  place_name: z.string().trim().min(1).max(PLACE_NAME_MAX_LENGTH).optional(),
  /**
   * An address or a map link. `http(s)` only, judged by the domain's `isLink`:
   * the confirmed screen turns this into something people tap, and a `javascript:`
   * or `data:` URL is not a place.
   */
  place_url: z.string().trim().max(2048).refine(isLink, 'not a link').optional(),
  note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).optional(),
  /**
   * "Did you have to chase anyone outside the app?" (spec §5.10). Two taps on
   * the review screen, and the evidence for H2 — so it is required rather than
   * optional: a survey nobody answers measures nothing, and `none` is an answer.
   */
  chased_answer: z.enum(['none', 'one', 'more']),
};

/** Lock in one of the options the engine offered. */
const ConfirmOption = Mutation.extend({
  plan_id: PlanId,
  candidate_id: Instant,
  ...ConfirmDetails,
  /**
   * The candidate set the options on the screen came from — the `id` of the
   * `candidate_sets` row the client already loaded to render them.
   *
   * Required, because "check the candidate belongs to the current set"
   * (architecture §9.1) is a question about *which* set was on the screen. An
   * answer arriving while the review screen is open recalculates inline
   * ([ADR 0018](../../../../docs/decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md)),
   * so by the time the organiser taps there is a new current set — and if the
   * time they picked is still eligible in it, confirming freezes an availability
   * list nobody looked at. Somebody who withdrew is on the card; somebody who
   * just answered is not.
   *
   * The id rather than a version number: a set is also replaced when the engine
   * changes, which moves no version the client can see.
   */
  expected_set_id: CandidateSetId,
}).strict();

/**
 * Lock in a day and time of the organiser's own, which no option offered
 * (ADR 0051).
 *
 * The stretch is two instants, validated by the domain's `ownTimeProblem` in the
 * database and on the screen. An own time has no set to name, so it names the
 * plan's `input_version` as `stretch_availability` returned it with the names
 * the organiser was shown: if an answer has landed since, the request is refused
 * as `stale_availability` and the screen updates and asks again, rather than
 * freezing a list nobody saw.
 */
const ConfirmOwnTime = Mutation.extend({
  plan_id: PlanId,
  starts_at: Instant,
  ends_at: Instant,
  expected_input_version: z.int().min(1),
  ...ConfirmDetails,
}).strict();

/**
 * One of the two, never both: a body that names a candidate and a stretch is
 * refused rather than guessed at.
 */
export const ConfirmMeetupRequest = z.union([ConfirmOption, ConfirmOwnTime]);
export type ConfirmMeetupRequest = z.infer<typeof ConfirmMeetupRequest>;
export type ConfirmOptionRequest = z.infer<typeof ConfirmOption>;
export type ConfirmOwnTimeRequest = z.infer<typeof ConfirmOwnTime>;

/** Narrowed by the field that only an own time has. */
export function isOwnTimeRequest(request: ConfirmMeetupRequest): request is ConfirmOwnTimeRequest {
  return 'starts_at' in request;
}

export const ConfirmMeetupResponse = z.object({
  confirmation_id: ConfirmationId,
  /** Frozen at this moment, and never changed by a later reply (architecture §6.2). */
  starts_at: Instant,
  ends_at: Instant,
  /**
   * Who could make it when it was locked in, in the plan's audience order.
   * Never a non-responder (spec §5.6).
   *
   * The paste-ready message is **not** here: it is built by the client from
   * this, with `lockedInMessage` in `packages/domain`. The server would have to
   * format a date for somebody whose locale and zone preferences it does not
   * have, and formatting is presentation (§5.4).
   */
  going: z.array(UserId),
});
export type ConfirmMeetupResponse = z.infer<typeof ConfirmMeetupResponse>;
