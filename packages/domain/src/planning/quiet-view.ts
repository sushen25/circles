/**
 * What one viewer may see of a quiet plan (spec §5.4, §8.2) — the single place
 * a client reads quiet state from.
 *
 * Three phases, each with a fixed set of keys that a test enumerates:
 *
 * - **seeking**: when it closes and what opens it. No count for anybody, the
 *   initiator included (§5.4.3), and not even the viewer's own answer — only
 *   that they gave one.
 * - **opened**: the keen count, fixed at the moment it opened (ADR 00XX), and
 *   the organiser's name once there is one. Never who was keen.
 * - **closed**: nothing, for everybody but the initiator of an ask that ran
 *   out of time, who is told it closed (SparkExpired). A withdrawn ask and an
 *   expired one look the same to everyone else, and so does a quiet plan that
 *   opened and was later cancelled — the database's `plan_interest_counts`
 *   shows no count for `expired` or `cancelled` for exactly this reason: it
 *   cannot tell those apart from an ask that never opened.
 *
 * **Never an initiator.** The viewer's own `isInitiator` goes in, because two
 * things on the initiator's own screen depend on it — withdrawing, and the
 * expiry notice — and it comes out only as those two capabilities, to that
 * viewer. Build a view per viewer, for that viewer; never compute one for
 * somebody else and ship it, which is the one way `mayWithdraw` becomes an
 * initiator flag.
 */

import type { UserId } from '../circles/types.js';
import { type Instant, isBefore } from '../shared/instant.js';
import { type Interest, isAsking } from './quiet.js';
import type { Plan } from './types.js';

export type QuietViewer = {
  readonly userId: UserId;
  /** An *active* member of the plan's circle. Anybody else sees nothing. */
  readonly isMember: boolean;
  readonly isPermanent: boolean;
  readonly isOwner: boolean;
  /** Resolved server-side, from `private.plan_initiators`, about this viewer only. */
  readonly isInitiator: boolean;
  /** This viewer's own answer, if they have given one. */
  readonly myAnswer: Interest | null;
};

export type QuietFacts = {
  readonly now: Instant;
  /** From `plan_interest_counts`, which has no row before the threshold. */
  readonly keenCount: number | null;
  readonly organiserName: string | null;
  /**
   * Whether the ask ever crossed its threshold — from its history, since an
   * `expired` plan looks the same either way. Read only for the initiator's
   * expiry notice, and unknown shows none: an ask that opened and later ran
   * past its last start is not one that "closed quietly".
   */
  readonly everOpened?: boolean | undefined;
};

export type SeekingView = {
  readonly phase: 'seeking';
  readonly closesAt: Instant;
  readonly threshold: number;
  /**
   * Whether this viewer has answered — not *what*. An answer is private even
   * from a screen its own author is holding: a phone read over a shoulder
   * shows "keen" to whoever is reading it. Changing an answer before the
   * threshold is offering both buttons again, which needs no record of which
   * was pressed.
   */
  readonly answeredByMe: boolean;
  readonly mayWithdraw: boolean;
};

export type OpenedView = {
  readonly phase: 'opened';
  readonly keenCount: number | null;
  readonly organiser: string | null;
  /** May take the organiser role now — the same rule `acceptOrganiser` applies. */
  readonly mayTakeRole: boolean;
};

export type ClosedView = {
  readonly phase: 'closed';
  /** The initiator's "this one closed quietly" — for an ask that ran out of time. */
  readonly showClosedNotice: boolean;
};

export type QuietView = SeekingView | OpenedView | ClosedView;

/** The keys of each phase, exactly. The test holds the functions to these. */
export const QUIET_VIEW_KEYS = {
  seeking: ['phase', 'closesAt', 'threshold', 'answeredByMe', 'mayWithdraw'],
  opened: ['phase', 'keenCount', 'organiser', 'mayTakeRole'],
  closed: ['phase', 'showClosedNotice'],
} as const;

/**
 * The viewer's view of a quiet plan, or `undefined` for a named plan or a
 * viewer who is not an active member.
 *
 * A quiet plan in `draft` has asked nobody yet and shows as closed. A seeking
 * plan past its stop time shows as closed, and so does one with no stop time —
 * a row the database is to refuse (SUS-50) — rather than inventing a time.
 */
export function quietView(
  plan: Plan,
  viewer: QuietViewer,
  facts: QuietFacts,
): QuietView | undefined {
  if (plan.mode !== 'quiet' || !viewer.isMember) return undefined;

  switch (plan.state) {
    case 'seeking': {
      // From its stop time an ask is closed, whether or not the dispatcher's
      // sweep has written `expired` yet: `recordInterest` refuses from then, so
      // a prompt still on screen would be a button that cannot work.
      const closesAt = plan.quietExpiresAt;
      if (closesAt === undefined || plan.quietThreshold === undefined) return closed(false);
      if (!isAsking(plan, facts.now)) return closed(false);
      return {
        phase: 'seeking',
        closesAt,
        threshold: plan.quietThreshold,
        answeredByMe: viewer.myAnswer !== null,
        mayWithdraw: viewer.isInitiator,
      };
    }
    case 'collecting':
    case 'ready':
    case 'confirmed':
    case 'completed':
      return {
        phase: 'opened',
        keenCount: facts.keenCount,
        organiser: plan.organiserUserId === undefined ? null : facts.organiserName,
        mayTakeRole: mayTakeRole(plan, viewer, facts.now),
      };
    case 'expired':
      return closed(viewer.isInitiator && facts.everOpened === false);
    case 'draft':
    case 'cancelled':
      return closed(false);
  }
}

function closed(showClosedNotice: boolean): ClosedView {
  return { phase: 'closed', showClosedNotice };
}

/** Mirrors `acceptOrganiser`: keen or the initiator, or the owner once replies closed. */
function mayTakeRole(plan: Plan, viewer: QuietViewer, now: Instant): boolean {
  if (plan.organiserUserId !== undefined) return false;
  if (plan.state !== 'collecting' && plan.state !== 'ready') return false;
  if (!viewer.isPermanent) return false;
  if (viewer.myAnswer === 'keen' || viewer.isInitiator) return true;
  return viewer.isOwner && !isBefore(now, plan.responseDeadline);
}
