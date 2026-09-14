import { z } from 'zod';

import { PlanId, UserId } from '../ids.js';
import { DailyWindow, DateWindow, DurationMinutes, Instant } from '../time.js';
import { Quorum } from './shared.js';
import { Mutation } from './shared.js';

/**
 * `revise-plan` — edit a plan, or reopen a confirmed one.
 *
 * Spec §5.3: an edit that invalidates responses "shows, **before saving**,
 * exactly who will be asked again". A client cannot work that out — a member may
 * read only their own response, which is what `plan_responses_select_own` is for
 * — so `preview` asks this endpoint the same question without changing
 * anything, and the answer is the same shape either way.
 *
 * What invalidates: the window, the band, the duration. Quorum and deadline
 * change what happens to the answers rather than the question, so they cost
 * nobody a second reply and bump no revision (`invalidatingChanges`).
 */
export const RevisePlanRequest = Mutation.extend({
  plan_id: PlanId,
  window: DateWindow.optional(),
  daily: DailyWindow.optional(),
  duration_minutes: DurationMinutes.optional(),
  response_deadline: Instant.optional(),
  quorum: Quorum.optional(),
  /**
   * Who has to be there. Spec §9: when a required person leaves, the plan is
   * ineligible "until the organiser changes required members or cancels" — so
   * this is how they change them. Absent leaves them alone; an empty array means
   * nobody is required.
   *
   * Not an edit: it changes which times are eligible, not what anybody was asked,
   * so it starts no revision and costs nobody a reply.
   */
  required_member_ids: z.array(UserId).optional(),
  /**
   * Unpick a confirmed meetup and go back to collecting (§5.7's "change time").
   * A different transition with a different event, so it is said rather than
   * inferred from the plan's state.
   */
  reopen: z.boolean().default(false),
  /** Answer the question and change nothing. The warning before saving. */
  preview: z.boolean().default(false),
  /**
   * The `version` a preview came back with, sent back when the edit is saved.
   *
   * §5.3's promise is that the organiser sees the cost **before** paying it, and
   * an answer arriving between the two calls made the preview wrong about the
   * one person it was most about: they were shown as a fresh ask, and the save
   * cleared a reply they had already given. The save reports the truth — it
   * reads the audience under the plan's lock — but "shown afterwards" is not
   * what the sentence says.
   *
   * So this is the token that says which plan the warning was about, in the
   * spirit of `replace_response`'s revision argument: send it and a plan that
   * has moved is refused rather than quietly costing somebody more than they
   * were told. Optional, because an edit that asks nobody again has no cost to
   * be shown and needs no preview.
   */
  expected_version: z.string().max(40).optional(),
}).refine(
  (body) =>
    body.window !== undefined ||
    body.daily !== undefined ||
    body.duration_minutes !== undefined ||
    body.response_deadline !== undefined ||
    body.quorum !== undefined ||
    body.required_member_ids !== undefined ||
    body.reopen,
  { message: 'an edit that changes nothing is not an edit' },
);
export type RevisePlanRequest = z.infer<typeof RevisePlanRequest>;

export const RevisePlanResponse = z.object({
  /** Absent on a preview: nothing was saved, so there is no new revision. */
  revision: z.int().positive().optional(),
  /**
   * Answered already, and must answer again because the question changed. The
   * client turns these into names; the ids are what it can resolve from the
   * roster it already has.
   */
  asked_again: z.array(UserId),
  /** Never answered. They get the same fresh ask they would have had anyway. */
  fresh_ask: z.array(UserId),
  /** `window`, `daily`, `duration` — empty when nothing about the question changed. */
  invalidating: z.array(z.enum(['window', 'daily', 'duration'])),
  /** Whether saving this would start a new revision and clear the answers. */
  bumps_revision: z.boolean(),
  /**
   * Which version of the plan this answer describes — its revision and the
   * count of changes to its inputs, which an arriving answer moves.
   *
   * Send it back as `expected_version` when saving what was previewed. Opaque
   * on purpose: it is a token to hand back, not two numbers to reason about.
   */
  version: z.string(),
});
export type RevisePlanResponse = z.infer<typeof RevisePlanResponse>;
