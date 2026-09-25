/**
 * Who gets asked to plan the next one (spec §5.9).
 *
 * Exactly one person is nudged, never the whole circle. A message to everyone
 * is a message to nobody, and the failure this product is built around is that
 * nobody starts.
 */

import { type Instant, compare } from '../shared/instant.js';
import { nudgeDueDate } from './cadence.js';
import { memberLimits } from './quorum.js';
import type { Circle, Member, NudgePolicy, UserId } from './types.js';
import { isActive } from './types.js';

/**
 * Take turns once a circle is big enough that one person always organising
 * becomes a burden; below that there is nobody to take turns with, so the owner
 * carries it (spec §5.2, "default take turns for circles of four or more").
 *
 * Resolved from the current member count rather than stored at creation, so a
 * circle that grows past three starts taking turns on its own. An explicit
 * choice always wins.
 */
export function effectiveNudgePolicy(circle: Circle, activeCount: number): NudgePolicy {
  if (circle.nudgePolicy !== undefined) return circle.nudgePolicy;
  return activeCount >= memberLimits.min + 1 ? 'take_turns' : 'owner';
}

/**
 * Someone who can actually receive a nudge, act on it, and has not said no.
 *
 * `mutedNudges` is "Nudges to plan the next one" on notification settings
 * (`circle_members.muted_nudges`); `mutedAll` is the whole circle. Either is a
 * no.
 */
function isNudgeable(member: Member): boolean {
  return isActive(member) && member.isPermanent && !member.mutedAll && !member.mutedNudges;
}

/** Still in the circle and has turned the nudge off, one way or the other. */
function saidNo(member: Member | undefined): boolean {
  return member !== undefined && isActive(member) && (member.mutedNudges || member.mutedAll);
}

function owner(circle: Circle, members: readonly Member[]): UserId | undefined {
  const found = members.find((m) => m.userId === circle.ownerUserId && isActive(m));
  return found?.userId;
}

/** Join order, then user id: the order the rotation walks, stable across retries. */
function byJoining(a: Member, b: Member): number {
  return compare(a.joinedAt, b.joinedAt) || a.userId.localeCompare(b.userId);
}

export type NudgeInput = {
  readonly circle: Circle;
  /**
   * The circle's members, **including anyone removed**: the rotation walks on
   * from the last organiser's place in join order, and somebody who organised
   * last and has since left still has one.
   */
  readonly members: readonly Member[];
  /** Members who were at the last meetup that actually happened. */
  readonly lastHappenedAttendees: readonly UserId[];
  /**
   * `| undefined` rather than merely optional: under
   * `exactOptionalPropertyTypes` a caller holding a `UserId | undefined` from a
   * database row could not pass it otherwise, and "nobody organised last" is an
   * ordinary state, not a missing argument.
   */
  readonly lastOrganiserId?: UserId | undefined;
  /**
   * People the nudge found no way to reach — no confirmed address, or one
   * that bounced, and no device. They are passed over as somebody who has
   * left would be: the turn passes on, and a last organiser out of reach
   * falls back to the owner. Not a no, so it never silences the policy
   * (review round 2: the turn went to somebody nothing was sent to).
   */
  readonly unreachable?: readonly UserId[] | undefined;
};

/**
 * Why this person was the one asked, for `cadence_prompt_sent`.
 *
 * `owner_fallback` is the owner asked because the policy found nobody — a
 * last organiser who has left, a meetup nobody was recorded at — which is a
 * different fact about the rotation from the owner being asked because the
 * circle chose "the owner".
 */
export type NudgeRole = 'owner' | 'last_organiser' | 'take_turns' | 'owner_fallback';

export type NudgeChoice = { readonly userId: UserId; readonly role: NudgeRole };

/**
 * The one person to nudge and why, or `undefined` when there is nobody — an
 * archived circle, no goal, or everyone who could be asked has said no.
 * Silence is the correct outcome then; the caller must not fall back to
 * "tell everybody".
 *
 * **A no is a no.** Under "whoever organised last" and "the owner" the policy
 * names one person, and if that person has turned nudges off nobody is asked:
 * handing the job to somebody else is exactly the labour the switch was for
 * (SUS-83). Under take turns a person who said no is skipped and the turn
 * passes on, because passing it on is what taking turns is.
 *
 * Otherwise it falls back to the owner at every dead end — a last organiser
 * who has left or cannot be reached, a meetup nobody was recorded at —
 * because the owner is the one person who certainly exists and certainly
 * cares.
 */
export function nudgeChoice(input: NudgeInput): NudgeChoice | undefined {
  const { circle, members, lastHappenedAttendees, lastOrganiserId } = input;
  if (circle.status === 'archived' || circle.cadence === 'none') return undefined;

  const active = members.filter(isActive);
  const policy = effectiveNudgePolicy(circle, active.length);
  const unreachable = new Set(input.unreachable ?? []);
  const nudgeable = members.filter((m) => isNudgeable(m) && !unreachable.has(m.userId));
  const eligible = (id: UserId | undefined): UserId | undefined =>
    id !== undefined && nudgeable.some((m) => m.userId === id) ? id : undefined;
  const find = (id: UserId | undefined): Member | undefined =>
    id === undefined ? undefined : members.find((m) => m.userId === id);

  const ownerId = eligible(owner(circle, members));
  const fallback: NudgeChoice | undefined =
    ownerId === undefined ? undefined : { userId: ownerId, role: 'owner_fallback' };

  switch (policy) {
    case 'owner':
      return ownerId === undefined ? undefined : { userId: ownerId, role: 'owner' };

    case 'last_organiser': {
      const organiser = eligible(lastOrganiserId);
      if (organiser !== undefined) return { userId: organiser, role: 'last_organiser' };
      if (saidNo(find(lastOrganiserId))) return undefined;
      return fallback;
    }

    case 'take_turns': {
      // Round-robin over the people who were actually there last time, in join
      // order so the rotation is stable and predictable rather than random.
      const attendees = nudgeable
        .filter((m) => lastHappenedAttendees.includes(m.userId))
        .sort(byJoining);
      const first = attendees[0];
      if (first === undefined) return fallback;

      // The turn passes to whoever comes after the last organiser in join
      // order, wrapping round — so three cycles ask three different people,
      // not the same two in alternation. With nobody on record as organising,
      // the turn starts at the beginning.
      const last = find(lastOrganiserId);
      const next =
        last === undefined ? first : (attendees.find((m) => byJoining(m, last) > 0) ?? first);
      // When the last organiser is the only one eligible the wrap lands on
      // them, and asking them again beats asking nobody.
      return { userId: next.userId, role: 'take_turns' };
    }
  }
}

/** The one person to nudge, or `undefined` for nobody. `nudgeChoice` without the why. */
export function nudgeRecipient(input: NudgeInput): UserId | undefined {
  return nudgeChoice(input)?.userId;
}

/**
 * Why a nudge already written should not go, now — or `undefined` to send it.
 *
 * A nudge can sit in the queue until morning (quiet hours), and a great deal
 * can happen overnight: somebody makes a plan, the owner snoozes, the person
 * turns nudges off, or leaves. Each of those is answered again at the moment
 * of sending rather than trusted from when the job was written, as the other
 * kinds' send-time checks are. The circle's archiving is the sender's own
 * check, shared with every other kind.
 */
export type NudgeHold = 'not_a_member' | 'nudges_off' | 'no_longer_due';

export function nudgeHeld(input: {
  readonly circle: Circle;
  /** The person the nudge is addressed to, as their membership stands now. */
  readonly member: Member | undefined;
  readonly now: Instant;
  readonly hasOpenPlan: boolean;
}): NudgeHold | undefined {
  const { circle, member, now, hasOpenPlan } = input;
  if (member === undefined || !isActive(member)) return 'not_a_member';
  if (member.mutedNudges || member.mutedAll) return 'nudges_off';
  if (nudgeDueDate(circle, now, hasOpenPlan) === undefined) return 'no_longer_due';
  return undefined;
}
