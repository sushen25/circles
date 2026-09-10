/**
 * Who gets told, and on what (spec §5.8, architecture §13).
 *
 * The dispatcher stays thin because every decision it would otherwise make is
 * here, as a pure function of state. That matters for two reasons: these rules
 * are the ones that go wrong quietly — a reminder to somebody who said they
 * cannot come, a quiet ask that reaches its own initiator — and they are
 * impossible to test against Resend and Expo.
 *
 * Three rules cut across every kind, and they are applied last so that no
 * audience rule can forget them:
 *
 * - a removed member is not a member;
 * - `mutedAll` means all, and `mutedQuietAsks` means the quiet ones;
 * - a recipient with no reachable channel is not a recipient, and the answer is
 *   silence rather than a fallback to somebody else.
 */

import { type Circle, type Member, type UserId, isActive } from '../circles/types.js';
import { type NudgeInput, nudgeRecipient } from '../circles/nudge.js';
import type { Attendance } from '../confirmation/types.js';
import type { Response } from '../availability/types.js';
import type { Plan } from '../planning/types.js';
import {
  type Channel,
  type NotificationKind,
  QUIET_SENSITIVE_KINDS,
  notificationSpec,
} from './kinds.js';

export type Recipient = {
  readonly userId: UserId;
  readonly channel: Channel;
};

export type EligibilityContext = {
  readonly circle: Circle;
  readonly plan: Plan;
  readonly members: readonly Member[];
  /** Answers to the plan's **current** revision. Older ones do not count. */
  readonly responses: readonly Response[];
  /** Whether this member has a registered device that can receive a push. */
  readonly hasPushDevice: (userId: UserId) => boolean;
  /**
   * Whoever caused the event, if a person did.
   *
   * Never told about their own action: the organiser who just locked Thursday
   * in does not need a push saying Thursday is locked in. Absent for the kinds
   * a clock causes — `deadline_approaching`, `reminder`, `about_time`.
   */
  readonly actorId?: UserId | undefined;
  /**
   * The quiet ask's initiator. Excluded from `quiet_ask` and the only recipient
   * of `threshold_initiator`; never named to anyone (spec §8.2).
   */
  readonly quietInitiatorId?: UserId | undefined;
  /** Who answered a quiet ask with interest. */
  readonly keenMemberIds?: readonly UserId[] | undefined;
  /** The confirmation's attendance, for `reminder`. */
  readonly attendance?: readonly Attendance[] | undefined;
  /**
   * Members already sent this kind for this plan.
   *
   * "At most one deadline reminder per member per plan" (spec §5.8) spans
   * revisions, so it cannot be derived from the plan: an edit bumps the
   * revision, and reminding everybody again because the organiser changed the
   * quorum is exactly the repeated nagging the rule forbids.
   */
  readonly alreadySent?: readonly UserId[] | undefined;
  /** For `about_time`: what `nudgeRecipient` needs, minus what is above. */
  readonly nudge?: Pick<NudgeInput, 'lastHappenedAttendees' | 'lastOrganiserId'> | undefined;
};

/** Members still eligible to be told anything at all about this circle. */
function reachableMembers(context: EligibilityContext): readonly Member[] {
  return context.members.filter(isActive);
}

function respondedUserIds(context: EligibilityContext): ReadonlySet<UserId> {
  return new Set(
    context.responses
      .filter((r) => r.planId === context.plan.id && r.revision === context.plan.revision)
      .map((r) => r.userId),
  );
}

/** The audience, before the cross-cutting rules are applied. */
function audienceFor(kind: NotificationKind, context: EligibilityContext): readonly UserId[] {
  const { audience } = notificationSpec(kind);
  const members = reachableMembers(context);
  const ids = members.map((m) => m.userId);

  switch (audience) {
    case 'members':
      return ids;

    case 'members_except_initiator':
      return ids.filter((id) => id !== context.quietInitiatorId);

    case 'quiet_initiator':
      return context.quietInitiatorId === undefined ? [] : [context.quietInitiatorId];

    case 'keen_members':
      return ids.filter((id) => context.keenMemberIds?.includes(id) === true);

    case 'non_responders': {
      const responded = respondedUserIds(context);
      const sent = new Set(context.alreadySent ?? []);
      return ids.filter((id) => !responded.has(id) && !sent.has(id));
    }

    case 'organiser': {
      const organiser = context.plan.organiserUserId;
      return organiser === undefined || !ids.includes(organiser) ? [] : [organiser];
    }

    case 'going_members': {
      const going = new Set(
        (context.attendance ?? []).filter((a) => a.status === 'going').map((a) => a.userId),
      );
      return ids.filter((id) => going.has(id));
    }

    case 'nudge_recipient': {
      const chosen = nudgeRecipient({
        circle: context.circle,
        members: context.members,
        lastHappenedAttendees: context.nudge?.lastHappenedAttendees ?? [],
        lastOrganiserId: context.nudge?.lastOrganiserId,
      });
      return chosen === undefined ? [] : [chosen];
    }

    case 'the_address':
      // A verification email is addressed to an address, not to a member: the
      // person may not be signed in, and the contact is not a membership. The
      // caller supplies it; there is nothing here to select.
      return [];
  }
}

/**
 * Whether this member has muted this kind.
 *
 * `mutedAll` is the whole circle. `mutedQuietAsks` is narrower and deliberately
 * so: someone who does not want to be asked "would you be up for something?"
 * every week still wants to know when a plan is actually confirmed.
 */
function isMuted(member: Member, kind: NotificationKind): boolean {
  if (member.mutedAll) return true;
  return member.mutedQuietAsks && QUIET_SENSITIVE_KINDS.includes(kind);
}

/**
 * The first channel this person can actually receive on, in the kind's
 * preference order — or `undefined`, which means nothing is sent.
 *
 * The organiser kinds list email second, which is the whole of review C6: the
 * organiser gets options-ready and did-it-happen by email until they install
 * the app, so Slice 1 needs no native build. A member kind lists push only;
 * web-only participants reach email through a verified per-plan subscription,
 * which is a different mechanism with its own consent (spec §5.8).
 */
export function channelFor(
  kind: NotificationKind,
  userId: UserId,
  context: EligibilityContext,
): Channel | undefined {
  for (const channel of notificationSpec(kind).channels) {
    if (channel === 'push' && context.hasPushDevice(userId)) return 'push';
    if (channel === 'email') return 'email';
  }
  return undefined;
}

/**
 * Everyone who should receive this kind for this plan, with the channel each
 * will receive it on. Empty is an ordinary answer.
 */
export function recipientsFor(
  kind: NotificationKind,
  context: EligibilityContext,
): readonly Recipient[] {
  const byId = new Map(context.members.map((m) => [m.userId, m] as const));

  return audienceFor(kind, context)
    .filter((userId) => userId !== context.actorId)
    .filter((userId) => {
      const member = byId.get(userId);
      return member !== undefined && !isMuted(member, kind);
    })
    .flatMap((userId) => {
      const channel = channelFor(kind, userId, context);
      return channel === undefined ? [] : [{ userId, channel }];
    });
}
