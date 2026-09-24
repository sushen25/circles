/**
 * The quiet ask (spec §5.4, ADR 00XX): who may start one, how interest is
 * counted, and when it opens into a plan.
 *
 * **Confidentiality is the point of the feature, so it is structural here.**
 * `Plan` has no initiator field and never will: the initiator lives in
 * `private.plan_initiators` (architecture §6.2, §14). The functions below that
 * need to know take it as a parameter — `QuietAsk.initiatorId`, or
 * `Actor.isInitiator` — and nothing they return carries it. A `QuietAsk` is a
 * server-side value, assembled under the plan's row lock by the function about
 * to write; it is never serialised to a client. What a client may see comes
 * from `quietView` alone.
 *
 * The refusal codes are the other half. There is no message on them, so the
 * obligation moves to whoever renders a code — the app from `copy/`, an email
 * template, a function's JSON — and it is this: **no wording, log line or
 * analytics property may let a quiet ask's initiator, or an individual answer,
 * be inferred.** `already_asking` is a refusal about the caller's own ask and
 * may say so to them; it must never be recorded against their id anywhere a
 * second person can read, because "this member was refused for already asking"
 * is the initiator's identity with extra steps. The same goes for an
 * `accept-organiser` source of `initiator`.
 */

import type { CircleStatus, UserId } from '../circles/types.js';
import { type Instant, addMinutes, isBefore } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import type { TransitionError } from './state-machine.js';
import type { Plan, PlanState } from './types.js';

/** A member's private answer to a quiet ask (architecture §3). */
export type Interest = 'keen' | 'not_this_time';

/**
 * A quiet plan with the two facts `Plan` must not carry: who started it, and
 * who answered what. Server-side only — see the module comment.
 *
 * The initiator counts as keen from creation (spec §5.4), and `answers` holds
 * that as an ordinary `keen` entry, so the count has one source. The database
 * does the same: the `threshold` guard in `planning.transition_plan` counts
 * `private.plan_interest` rows and nothing else.
 */
export type QuietAsk = {
  readonly plan: Plan;
  readonly initiatorId: UserId;
  readonly answers: ReadonlyMap<UserId, Interest>;
};

export type QuietRefusal =
  | 'needs_saved_place'
  | 'needs_membership'
  | 'circle_archived'
  | 'quiet_asks_muted'
  | 'nobody_to_ask'
  | 'plan_in_progress'
  | 'already_asking'
  | 'circle_ask_limit'
  | 'not_quiet'
  | 'interest_closed'
  | 'initiator_is_keen'
  | 'window_has_passed'
  | 'stop_time_not_reached'
  | 'no_stop_time'
  | 'not_keen'
  | 'not_the_owner'
  | 'deadline_not_passed';

/** A transition refusal from the table, or one of the quiet ask's own. */
export type QuietError = TransitionError | { readonly code: QuietRefusal };

const refuse = <T>(code: QuietRefusal): Result<QuietError, T> => err({ code });

/**
 * The limits on starting one (spec §5.4, checked against twenty by ADR 00XX).
 *
 * Neither scales with the circle. The circle limit bounds what each *member
 * receives* — every ask prompts everybody — and a member of a circle of twenty
 * reads the same three prompts a week as a member of a circle of six. Letting
 * it grow with the roster would make the larger circle the noisier one, which
 * is backwards. One open ask per member is about the member, not the circle.
 */
export const QUIET_LIMITS = {
  activePerMember: 1,
  perCircle: 3,
  perCircleDays: 7,
} as const;

/**
 * How many keen answers, the initiator's included, open the ask (ADR 00XX).
 *
 * `min(n, max(3, ceil(n / 4)))`: three, for every circle of up to twelve —
 * exactly what spec §5.4 had, for the circles it was drawn for — and a quarter
 * of the circle above that, so a circle of twenty needs five. Three was a
 * quarter of the old cap of twelve; holding it constant as the cap went to
 * twenty (ADR 0012) would have let 15% of a circle open a plan that asks all of
 * it for times. Never more than the circle, so a circle of two can still ask.
 *
 * n=2→2, 3→3, 6→3, 12→3, 13→4, 16→4, 17→5, 20→5.
 *
 * Computed once, at creation, and stored (`plans.quiet_threshold`). Not
 * recomputed as people join or leave: a threshold that moves while answers
 * arrive is one somebody can watch move.
 */
export function quietThreshold(activeMembers: number): number {
  if (!Number.isInteger(activeMembers) || activeMembers < 0) {
    throw new RangeError(`Not a member count: ${activeMembers}`);
  }
  return Math.min(activeMembers, Math.max(3, Math.ceil(activeMembers / 4)));
}

/** A quiet ask in the circle, as the would-be asker is allowed to know it. */
export type RecentQuietAsk = {
  readonly createdAt: Instant;
  readonly state: PlanState;
  /** Whether the caller started it — about themselves, so theirs to know. */
  readonly mine: boolean;
};

export type QuietAskRequest = {
  readonly member: {
    readonly isPermanent: boolean;
    /** An *active* member of the circle. */
    readonly isMember: boolean;
    readonly mutedQuietAsks: boolean;
  };
  readonly circle: { readonly status: CircleStatus; readonly activeMembers: number };
  /** Absent means unknown, and unknown refuses (ADR 0033, SUS-89). */
  readonly circleHasOpenPlan?: boolean | undefined;
  /**
   * The circle's quiet asks created in the last `perCircleDays`, and any older
   * one still `seeking`. Every state counts toward the circle limit — a
   * withdrawn or expired ask still prompted everyone.
   */
  readonly recentAsks: readonly RecentQuietAsk[];
  readonly now: Instant;
};

/**
 * Whether this member may start a quiet ask here, or the first reason not.
 *
 * The order is deliberate. Identity and membership first, as `mayOrganiseInCircle`
 * does. Muting before anything that depends on other people's asks, so a member
 * who has muted quiet asks — and so received none of them — is not told by a
 * refusal that some exist. `nobody_to_ask` for a circle of one: its threshold
 * is one, which the initiator meets alone, and a quiet ask that opens the moment
 * it is made is a named plan with no organiser (the database's
 * `plans_quiet_threshold` refuses a threshold under two for the same reason).
 */
export function canCreateQuietAsk(request: QuietAskRequest): 'allowed' | QuietRefusal {
  const { member, circle, recentAsks, now } = request;
  if (!member.isPermanent) return 'needs_saved_place';
  if (!member.isMember) return 'needs_membership';
  if (circle.status !== 'active') return 'circle_archived';
  if (member.mutedQuietAsks) return 'quiet_asks_muted';
  if (circle.activeMembers < 2) return 'nobody_to_ask';
  if (request.circleHasOpenPlan !== false) return 'plan_in_progress';

  const mineSeeking = recentAsks.filter((a) => a.mine && a.state === 'seeking').length;
  if (mineSeeking >= QUIET_LIMITS.activePerMember) return 'already_asking';

  const since = addMinutes(now, -QUIET_LIMITS.perCircleDays * 24 * 60);
  const inWindow = recentAsks.filter((a) => isBefore(since, a.createdAt)).length;
  if (inWindow >= QUIET_LIMITS.perCircle) return 'circle_ask_limit';

  return 'allowed';
}

export function keenCount(ask: QuietAsk): number {
  let count = 0;
  for (const answer of ask.answers.values()) if (answer === 'keen') count += 1;
  return count;
}

/** Enough keen answers — whether or not the ask may open yet. */
export function thresholdMet(ask: QuietAsk): boolean {
  const threshold = ask.plan.quietThreshold;
  return threshold !== undefined && keenCount(ask) >= threshold;
}

/** Still asking: `seeking`, with a stop time that has not arrived. */
export function isAsking(plan: Plan, now: Instant): boolean {
  return (
    plan.mode === 'quiet' &&
    plan.state === 'seeking' &&
    plan.quietExpiresAt !== undefined &&
    isBefore(now, plan.quietExpiresAt)
  );
}

export type InterestContext = {
  readonly now: Instant;
  /** Absent means unknown, and unknown holds the ask rather than opening it. */
  readonly circleHasOpenPlan?: boolean | undefined;
};

/**
 * Safe to hand back to the person who answered, in full. It carries no count:
 * `false` means "not open yet" whether one more answer is needed or ten, and
 * whether the ask is below its threshold or held beside an open plan.
 */
export type InterestRecorded = {
  readonly ask: QuietAsk;
  /** The answer differs from the one on record. A repeat is not an error. */
  readonly changed: boolean;
  /** The ask should open now: call `onThreshold` in the same transaction. */
  readonly thresholdReached: boolean;
};

/**
 * Record one member's answer (spec §5.4).
 *
 * Idempotent per member: the same answer twice changes nothing, and a
 * different one replaces it while the ask is still asking. Once it has opened,
 * interest is closed — the count shown after threshold (ADR 00XX) is fixed at
 * the moment it opened, so two reads of it can never be differenced to find out
 * who answered in between. Members who were not keen add their *times* to the
 * opened plan instead (§5.4.6), which is a different question.
 *
 * The initiator's answer is `keen` from creation and stays so. To stop, they
 * withdraw.
 *
 * Membership is the caller's to check, as it is for every write: an id is not
 * membership.
 */
export function recordInterest(
  ask: QuietAsk,
  memberId: UserId,
  response: Interest,
  context: InterestContext,
): Result<QuietError, InterestRecorded> {
  if (ask.plan.mode !== 'quiet') return refuse('not_quiet');
  if (!isAsking(ask.plan, context.now)) return refuse('interest_closed');
  if (memberId === ask.initiatorId && response !== 'keen') return refuse('initiator_is_keen');

  const changed = ask.answers.get(memberId) !== response;
  const answers = new Map(ask.answers);
  answers.set(memberId, response);
  const next: QuietAsk = { ...ask, answers };

  // Evaluated on every answer, a repeat included: an ask held beside an open
  // plan opens on the first answer after that plan finishes (ADR 00XX).
  const thresholdReached = thresholdMet(next) && context.circleHasOpenPlan === false;
  return ok({ ask: next, changed, thresholdReached });
}
