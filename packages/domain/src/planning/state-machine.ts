/**
 * The plan state machine (architecture §8.3), as data.
 *
 * `TRANSITIONS` is exported as a plain array so that S1-08 can generate the
 * `planning.transition_plan()` SQL mirror from it and a test can diff the two.
 * A state machine written twice is a state machine that disagrees with itself,
 * usually months later and in production.
 */

import { type Result, err, ok } from '../shared/result.js';
import { type Plan, type PlanState, isTerminal } from './types.js';

export type PlanAction =
  | 'create_named'
  | 'create_quiet'
  | 'threshold_reached'
  | 'expire'
  | 'candidates_ready'
  | 'candidates_gone'
  | 'edit'
  | 'confirm'
  | 'reopen'
  | 'cancel'
  | 'report_outcome'
  | 'accept_organiser';

/** What the caller is, relative to this plan. Resolved by the caller, not here. */
export type Actor = {
  readonly userId: string;
  /** Apple, Google or email code — not an anonymous session (ADR 0004). */
  readonly isPermanent: boolean;
  readonly isMember: boolean;
  readonly isOrganiser: boolean;
  readonly isOwner: boolean;
  /**
   * Started this quiet ask. Resolved by the caller from `private.plan_initiators`,
   * which is the only place the fact lives — it is deliberately not on the plan,
   * because a plan row is readable by the whole circle (spec §8.2).
   */
  readonly isInitiator?: boolean | undefined;
  /** Answered a quiet ask with interest. */
  readonly isKeen?: boolean | undefined;
};

export type TransitionErrorCode =
  | 'wrong_state'
  | 'not_a_member'
  | 'not_the_organiser'
  | 'not_the_initiator'
  | 'not_keen_or_initiator'
  | 'needs_permanent_identity'
  | 'already_has_organiser'
  | 'needs_candidate'
  | 'plan_is_finished';

/**
 * A code and the context it happened in — **no message**.
 *
 * Wording is presentation and lives in `apps/app/src/copy`; the same code has
 * to render differently in the app, in an email and in an Edge Function's JSON,
 * and a string baked in here would be the app's version of it everywhere. The
 * codes are shared with the SQL mirror (S1-08) so client and server name the
 * same refusal.
 *
 * Whatever wording a caller chooses must say what is true without saying who
 * did what — a quiet ask's initiator must not be inferable from an error.
 */
export type TransitionError = {
  readonly code: TransitionErrorCode;
  readonly action: PlanAction;
  readonly from: PlanState;
};

export type TransitionContext = {
  readonly actor: Actor;
  /** Required by `confirm`: the candidate being locked in. */
  readonly candidateId?: string | undefined;
  /**
   * The candidates currently on offer, from the plan's live candidate set.
   *
   * `confirm` checks membership rather than merely that an id was supplied: a
   * candidate can stop being eligible between the organiser opening the review
   * screen and tapping the button, because somebody withdrew a response. Absent
   * means "unknown", and unknown fails closed — confirming a time nobody can
   * make is worse than a refusal the organiser can retry.
   */
  readonly eligibleCandidateIds?: readonly string[] | undefined;
};

type Guard =
  | 'member'
  | 'organiser'
  | 'permanent'
  | 'no_organiser_yet'
  | 'candidate'
  | 'initiator'
  | 'keen_or_initiator';

export type Transition = {
  readonly from: PlanState;
  readonly action: PlanAction;
  readonly to: PlanState;
  /** All must hold. Order matters only for which error is reported first. */
  readonly guards: readonly Guard[];
  /** An edit or a reopen changes what was asked, so responses belong to a new revision. */
  readonly bumpsRevision?: true;
};

/**
 * Every legal move. Anything not in this table is illegal, which is why the
 * default is refusal rather than a permissive fallthrough.
 */
export const TRANSITIONS: readonly Transition[] = [
  // Creation. A permanent identity is required to start something that other
  // people will be asked to answer (ADR 0004).
  { from: 'draft', action: 'create_named', to: 'collecting', guards: ['member', 'permanent'] },
  { from: 'draft', action: 'create_quiet', to: 'seeking', guards: ['member', 'permanent'] },

  // Quiet ask. The threshold transition is atomic and happens once (§6.2);
  // enforcing "once" is the database's job, not this table's.
  { from: 'seeking', action: 'threshold_reached', to: 'collecting', guards: [] },
  { from: 'seeking', action: 'expire', to: 'expired', guards: [] },
  // The role is offered **at** the threshold, not before it: the ThresholdRole
  // screen opens with "Enough people are keen." Offering it during `seeking`
  // would ask someone to organise a plan nobody yet knows has support.
  {
    from: 'collecting',
    action: 'accept_organiser',
    to: 'collecting',
    guards: ['member', 'permanent', 'no_organiser_yet', 'keen_or_initiator'],
  },
  // And it must survive replies closing. "If nobody volunteers before replies
  // close, the circle owner gets a quiet nudge" — that nudge is worthless if
  // the role can no longer be accepted, and a quiet plan whose candidates are
  // ready with no organiser would otherwise be stuck until it expired.
  {
    from: 'ready',
    action: 'accept_organiser',
    to: 'ready',
    guards: ['member', 'permanent', 'no_organiser_yet', 'keen_or_initiator'],
  },
  // Withdrawing a quiet ask before threshold. The guard is `initiator`, not
  // `organiser`: a seeking plan has no organiser by definition, so `organiser`
  // made this transition unreachable for every actor — the row was in the table
  // and could never fire. "The initiator of a quiet ask withdraws it before
  // threshold: closed privately, nobody told" (spec §5.4).
  { from: 'seeking', action: 'cancel', to: 'cancelled', guards: ['initiator'] },

  // Collecting availability. `candidates_ready` and `candidates_gone` are the
  // engine's verdict, not a person's, so they carry no actor guard.
  { from: 'collecting', action: 'candidates_ready', to: 'ready', guards: [] },
  {
    from: 'collecting',
    action: 'edit',
    to: 'collecting',
    guards: ['organiser'],
    bumpsRevision: true,
  },
  { from: 'collecting', action: 'expire', to: 'expired', guards: [] },
  { from: 'collecting', action: 'cancel', to: 'cancelled', guards: ['organiser'] },

  // Ready. A response can be withdrawn or changed, which can take the plan back.
  { from: 'ready', action: 'candidates_gone', to: 'collecting', guards: [] },
  { from: 'ready', action: 'edit', to: 'collecting', guards: ['organiser'], bumpsRevision: true },
  { from: 'ready', action: 'confirm', to: 'confirmed', guards: ['organiser', 'candidate'] },
  { from: 'ready', action: 'expire', to: 'expired', guards: [] },
  { from: 'ready', action: 'cancel', to: 'cancelled', guards: ['organiser'] },

  // Confirmed. "Change the time" is a reopen: a new revision, and the previous
  // confirmation is superseded rather than edited (spec §5.7).
  {
    from: 'confirmed',
    action: 'reopen',
    to: 'collecting',
    guards: ['organiser'],
    bumpsRevision: true,
  },
  { from: 'confirmed', action: 'cancel', to: 'cancelled', guards: ['organiser'] },
  { from: 'confirmed', action: 'report_outcome', to: 'completed', guards: ['organiser'] },
];

const GUARD_ERRORS: Record<Guard, TransitionErrorCode> = {
  member: 'not_a_member',
  organiser: 'not_the_organiser',
  permanent: 'needs_permanent_identity',
  no_organiser_yet: 'already_has_organiser',
  candidate: 'needs_candidate',
  initiator: 'not_the_initiator',
  keen_or_initiator: 'not_keen_or_initiator',
};

function fails(guard: Guard, context: TransitionContext): boolean {
  const { actor, candidateId } = context;
  switch (guard) {
    case 'member':
      return !actor.isMember;
    case 'organiser':
      return !actor.isOrganiser;
    case 'permanent':
      return !actor.isPermanent;
    case 'no_organiser_yet':
      return false; // depends on the plan, checked in canTransition
    case 'initiator':
      return actor.isInitiator !== true;
    case 'keen_or_initiator':
      // Architecture §9.1: "accept-organiser | keen member (quiet) or
      // initiator". Somebody who answered `not_this_time`, or never answered,
      // is not being offered the job of arranging it.
      return actor.isKeen !== true && actor.isInitiator !== true;
    case 'candidate': {
      if (candidateId === undefined || candidateId.length === 0) return true;
      // Fails closed when the caller did not say what is on offer.
      return context.eligibleCandidateIds?.includes(candidateId) !== true;
    }
  }
}

export function transitionsFrom(state: PlanState): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.from === state);
}

/**
 * Whether the move is legal, and the plan it produces.
 *
 * Returns a `Result` rather than throwing: "you are not the organiser" is an
 * ordinary answer the UI renders, not an exception.
 */
export function canTransition(
  plan: Plan,
  action: PlanAction,
  context: TransitionContext,
): Result<TransitionError, Plan> {
  const fail = (code: TransitionErrorCode): Result<TransitionError, Plan> =>
    err({ code, action, from: plan.state });

  const transition = TRANSITIONS.find((t) => t.from === plan.state && t.action === action);
  if (transition === undefined) {
    // A finished plan gets its own message: "not right now" is misleading when
    // the answer is "not ever".
    return fail(isTerminal(plan.state) ? 'plan_is_finished' : 'wrong_state');
  }

  for (const guard of transition.guards) {
    if (guard === 'no_organiser_yet') {
      if (plan.organiserUserId !== undefined) return fail('already_has_organiser');
      continue;
    }
    if (fails(guard, context)) return fail(GUARD_ERRORS[guard]);
  }

  return ok(apply(plan, transition, context));
}

function apply(plan: Plan, transition: Transition, context: TransitionContext): Plan {
  const next: Plan = {
    ...plan,
    state: transition.to,
    revision: transition.bumpsRevision === true ? plan.revision + 1 : plan.revision,
  };

  // Accepting the role is the one transition that appoints an organiser. Every
  // other transition leaves the organiser alone — an edit or a reopen does not
  // hand the plan to somebody else.
  if (transition.action === 'accept_organiser') {
    return { ...next, organiserUserId: context.actor.userId as Plan['organiserUserId'] };
  }
  return next;
}
