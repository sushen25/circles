import { MAX_WINDOW_DAYS } from '@circles/domain';
import { z } from 'zod';

import { CandidateSetId, PlanId, ResponseId } from '../ids.js';
import { Interval } from '../time.js';
import { Mutation } from './shared.js';

/**
 * What the plan looks like now that the engine has run.
 *
 * Three words rather than two, because the screen has three states and only two
 * of them are plan states (spec §5.6): `ready` has options to show, `no_quorum`
 * has near-misses and the one rule that blocked them, and `collecting` is the
 * waiting state — "members see nothing until options exist". The difference
 * between the last two is whether anybody has answered yet, which is a fact
 * about the set rather than about the plan.
 */
export const CandidateSummary = z.object({
  /**
   * The set that is current for the plan *now* — which is not always the one
   * this request computed. An answer landing mid-recalculation makes the result
   * in hand stale, and it is discarded rather than stored; the summary then
   * describes what the plan actually has, because that is the thing a screen
   * can show. Absent when it has none yet.
   */
  candidate_set_id: CandidateSetId.optional(),
  /**
   * `closed` is the fourth answer and not a screen: a plan that has been
   * confirmed, cancelled or expired shows no candidates, and a caller who asked
   * about one should not be told it is still collecting.
   */
  state: z.enum(['collecting', 'ready', 'no_quorum', 'closed']),
  /** How many starts were eligible, not how many are offered — at most three are. */
  eligible: z.int().nonnegative(),
  near_misses: z.int().nonnegative(),
  /**
   * The plan's input version as this summary was taken. An answer bumps it, so
   * a client can tell its own write from somebody else's arriving at the same
   * moment — and tell a discarded recalculation from a stored one.
   */
  input_version: z.int().nonnegative(),
});
export type CandidateSummary = z.infer<typeof CandidateSummary>;

/**
 * `submit-availability` — one member's answer to one revision, and what it did.
 *
 * The five outcomes are the spec's (§5.5), not a subset: "none of these dates"
 * is deliberately three-way, because somebody who wants to come but cannot this
 * fortnight is telling you something different from somebody who is out. An
 * earlier draft of this schema had three, which would have made
 * `more_notice` — a whole branch of the editor — unsendable.
 *
 * The **revision** is required and is an integer, because an answer is an answer
 * to a question and the question can change while a draft sits on a phone with
 * no signal. `replace_response` refuses one the plan has moved past rather than
 * storing yesterday's windows against today's dates.
 */
export const SubmitAvailabilityRequest = Mutation.extend({
  plan_id: PlanId,
  revision: z.int().positive(),
  status: z.enum(['windows', 'flexible', 'none_work', 'more_notice', 'not_this_time']),
  /**
   * Absolute spans, half-hour aligned in the plan's zone once normalised.
   *
   * The cap is the largest answer a valid plan can produce, derived rather than
   * guessed: `MAX_WINDOW_DAYS` is the window maximum (`plans_window_length`,
   * thirty since ADR 0030), a daily band may run the whole day (`validateBand`
   * allows 00:00–24:00), and alternating half-hour cells across 24 hours is 24
   * disjoint windows — so 720, and it moves with the cap. An earlier
   * 200 was a round number that would have refused a real answer somebody had
   * spent a minute painting, before normalisation had a chance to merge it.
   */
  windows: z
    .array(Interval)
    .max(MAX_WINDOW_DAYS * 24)
    .default([]),
  /**
   * Whether the device calendar helped fill this in (Slice 3). A flag and
   * nothing else: raw calendar events never cross the boundary (spec §5.5).
   */
  used_calendar_overlay: z.boolean().default(false),
}).refine((body) => (body.status === 'windows') === body.windows.length > 0, {
  message: 'only a windows answer carries windows, and it carries at least one',
  path: ['windows'],
});
export type SubmitAvailabilityRequest = z.infer<typeof SubmitAvailabilityRequest>;

export const SubmitAvailabilityResponse = z.object({
  response_id: ResponseId,
  /** The revision the answer was stored against — the one that was asked. */
  revision: z.int().positive(),
  /**
   * The engine ran in the same request ([ADR 0018](../../../../docs/decisions/0018-the-recalculation-runs-in-the-request-that-caused-it.md)),
   * and this is what it found. The plan's `input_version` is in here rather than
   * beside it: there is one version being described, and two copies of it could
   * disagree.
   *
   * **Absent when the recalculation could not run.** The answer is stored either
   * way — it is a committed transaction of its own — and saying nothing about
   * the candidates is the honest report of not knowing. Everything refetches on
   * focus (§9.2), so a client told nothing asks again.
   */
  candidates: CandidateSummary.optional(),
});
export type SubmitAvailabilityResponse = z.infer<typeof SubmitAvailabilityResponse>;
