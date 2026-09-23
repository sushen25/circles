/**
 * Who gets told, and on what (spec §5.8, architecture §13).
 *
 * The dispatcher stays thin because every decision it would otherwise make is
 * here, as a pure function of state. That matters for two reasons: these rules
 * are the ones that go wrong quietly — a reminder to somebody who said they
 * cannot come, a quiet ask that reaches its own initiator — and they are
 * impossible to test against Resend and Expo.
 *
 * Five rules cut across every kind, and they are applied last so that no
 * audience rule can forget them:
 *
 * - an archived circle prompts nobody ("Archiving stops all prompts", spec
 *   §5.2);
 * - a member of another circle is not a member of this one;
 * - a removed member is not a member;
 * - `mutedAll` means all, and `mutedQuietAsks` means the quiet ones;
 * - a recipient with no reachable channel is not a recipient, and the answer is
 *   silence rather than a fallback to somebody else.
 *
 * The first of those is not a caller's job. "Every plan belongs to one circle;
 * only active members see or act on it" is a structural invariant (§8.2), and a
 * rule that holds only when every caller assembles a perfect list is a rule
 * that will be broken by the first caller who passes two circles' members.
 */

import { type Circle, type Member, type UserId, isActive } from '../circles/types.js';
import { type NudgeInput, nudgeRecipient } from '../circles/nudge.js';
import type { Attendance, ConfirmationId } from '../confirmation/types.js';
import type { Response } from '../availability/types.js';
import type { Plan } from '../planning/types.js';
import {
  type Channel,
  type NotificationKind,
  QUIET_SENSITIVE_KINDS,
  notificationSpec,
  organiserEmailStopped,
} from './kinds.js';

export type Recipient = {
  readonly userId: UserId;
  readonly channel: Channel;
};

export type EligibilityContext = {
  readonly circle: Circle;
  readonly plan: Plan;
  readonly members: readonly Member[];
  /**
   * Who this plan was addressed to: the circle's active members when it was
   * created, plus anyone who has since opted into it.
   *
   * Required, and not derived from `members`, because "new members may opt into
   * the active plan" (spec §9) is an opt-in. A newcomer who has not taken it is
   * neither told about the plan nor counted as owing a reply — otherwise
   * joining a circle on Tuesday makes you a non-responder to a question you
   * were never asked.
   */
  readonly participantIds: readonly UserId[];
  /** Answers to the plan's **current** revision. Older ones do not count. */
  readonly responses: readonly Response[];
  /** Whether this member has a registered device that can receive a push. */
  readonly hasPushDevice: (userId: UserId) => boolean;
  /**
   * Whether this member has a **verified** email subscription to this plan.
   *
   * Defaults to nobody. Being in a circle is not consent to be emailed: the
   * subscription is asked for per plan, verified by a link, and is never
   * marketing consent (§8.2).
   */
  readonly hasPlanEmailSubscription?: ((userId: UserId) => boolean) | undefined;
  /**
   * Whether this person has turned "Emails about plans you organise" off
   * (`profiles.muted_organiser_email`, ADR 00XX).
   *
   * Required, unlike the subscription above, because its absence would mean
   * *send*: a caller that forgot it would ignore the person's choice without a
   * sound. Read only by the email-channel test, so a push is unaffected.
   */
  readonly mutedOrganiserEmail: (userId: UserId) => boolean;
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
  /**
   * The plan's attendance rows, for `reminder`, and the confirmation they must
   * belong to.
   *
   * Both: a superseded confirmation keeps its rows — that is the point of
   * superseding rather than mutating — so a `going` from the Thursday that was
   * called off would put somebody on the reminder list for the Saturday they
   * said they could not make.
   */
  readonly attendance?: readonly Attendance[] | undefined;
  readonly confirmationId?: ConfirmationId | undefined;
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
  return context.members.filter((m) => m.circleId === context.circle.id && isActive(m));
}

/** The members this plan was actually addressed to. */
function participants(context: EligibilityContext): readonly UserId[] {
  const invited = new Set(context.participantIds);
  return reachableMembers(context)
    .map((m) => m.userId)
    .filter((id) => invited.has(id));
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

  // The cadence nudge is about the circle and would be sent with no plan at
  // all if the type allowed it, so it is answered before the plan is consulted.
  if (audience === 'nudge_recipient') {
    const chosen = nudgeRecipient({
      circle: context.circle,
      members: reachableMembers(context),
      lastHappenedAttendees: context.nudge?.lastHappenedAttendees ?? [],
      lastOrganiserId: context.nudge?.lastOrganiserId,
    });
    return chosen === undefined ? [] : [chosen];
  }

  // Everything else is plan-scoped: one circle, and only the people the plan
  // was addressed to.
  if (context.plan.circleId !== context.circle.id) return [];
  const ids = participants(context);

  switch (audience) {
    case 'members':
      return ids;

    case 'members_except_initiator':
      return ids.filter((id) => id !== context.quietInitiatorId);

    case 'quiet_initiator': {
      // Through `ids`, so an initiator who has since left the circle is not
      // offered the organiser role — this audience is the one that names a
      // single person rather than filtering a list, and it would otherwise skip
      // every check the others get for free.
      const initiator = context.quietInitiatorId;
      return initiator !== undefined && ids.includes(initiator) ? [initiator] : [];
    }

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

    case 'subscribed_members':
      // Everyone who asked, in writing, to hear about this plan by email. The
      // subscription is the audience here rather than a channel gate, because
      // the push version of this message goes to the organiser alone.
      return ids.filter((id) => context.hasPlanEmailSubscription?.(id) === true);

    case 'going_members': {
      // Nobody at all until the caller says which confirmation this is about:
      // reminding the wrong evening's guests is worse than reminding nobody,
      // and failing closed is the only safe reading of an ambiguous input.
      if (context.confirmationId === undefined) return [];
      const going = new Set(
        (context.attendance ?? [])
          .filter((a) => a.confirmationId === context.confirmationId && a.status === 'going')
          .map((a) => a.userId),
      );
      return ids.filter((id) => going.has(id));
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
  const spec = notificationSpec(kind);
  for (const channel of spec.channels) {
    if (channel === 'push' && context.hasPushDevice(userId)) return 'push';
    if (channel === 'email' && mayEmail(spec, userId, context)) return 'email';
  }
  return undefined;
}

/**
 * Whether email is allowed for this person and this kind.
 *
 * The member kinds need a verified per-plan subscription; the organiser kinds
 * do not, which is the whole of review C6 — unless the person has turned
 * organiser email off, for the kinds that switch covers (ADR 00XX). Nothing here reads a members list to
 * decide it — that was the bug: `channels: ['push', 'email']` made membership
 * look like consent.
 */
function mayEmail(
  spec: ReturnType<typeof notificationSpec>,
  userId: UserId,
  context: EligibilityContext,
): boolean {
  if (!spec.emailNeedsSubscription) {
    return !organiserEmailStopped(spec.kind, context.mutedOrganiserEmail(userId));
  }
  return context.hasPlanEmailSubscription?.(userId) === true;
}

/**
 * Everyone who should receive this kind for this plan, with the channel each
 * will receive it on. Empty is an ordinary answer.
 */
export function recipientsFor(
  kind: NotificationKind,
  context: EligibilityContext,
): readonly Recipient[] {
  // Built from the reachable members, not from `context.members`: a map keyed
  // on `userId` alone lets another circle's row overwrite this one's, and the
  // mute flags then come from the wrong membership.
  const byId = new Map(reachableMembers(context).map((m) => [m.userId, m] as const));

  // Before any audience is worked out: an archived circle has nobody to tell.
  // `nudgeRecipient` already answers undefined for one; the plan kinds did not.
  if (context.circle.status === 'archived') return [];

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
