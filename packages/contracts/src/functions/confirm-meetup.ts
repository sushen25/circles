import { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH, isLink } from '@circles/domain';
import { z } from 'zod';

import { ConfirmationId, PlanId, UserId } from '../ids.js';
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
 */
export const ConfirmMeetupRequest = Mutation.extend({
  plan_id: PlanId,
  candidate_id: Instant,
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
  /**
   * Which version of the plan the candidates on the screen came from, as
   * `<revision>.<input_version>` — the same token `revise-plan` uses, and
   * readable from the `candidate_sets` row the client already loaded.
   *
   * Required, because "check the candidate belongs to the current set"
   * (architecture §9.1) is a question about *which* set was on the screen. An
   * answer arriving while the review screen is open recalculates inline
   * ([ADR 0018](../../../../docs/decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md)),
   * so by the time the organiser taps there is a new current set — and if the
   * time they picked is still eligible in it, confirming freezes an availability
   * list nobody looked at. Somebody who withdrew is on the card; somebody who
   * just answered is not.
   */
  expected_version: z.string().max(40),
});
export type ConfirmMeetupRequest = z.infer<typeof ConfirmMeetupRequest>;

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
