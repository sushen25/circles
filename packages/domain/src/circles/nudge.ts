/**
 * Who gets asked to plan the next one (spec §5.9).
 *
 * Exactly one person is nudged, never the whole circle. A message to everyone
 * is a message to nobody, and the failure this product is built around is that
 * nobody starts.
 */

import { compare } from '../shared/instant.js';
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

/** Someone who can actually receive a nudge and act on it. */
function isNudgeable(member: Member): boolean {
  return isActive(member) && member.isPermanent && !member.mutedAll;
}

function owner(circle: Circle, members: readonly Member[]): UserId | undefined {
  const found = members.find((m) => m.userId === circle.ownerUserId && isActive(m));
  return found?.userId;
}

export type NudgeInput = {
  readonly circle: Circle;
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
};

/**
 * The one person to nudge, or `undefined` when there is nobody eligible — an
 * archived circle, or one where everyone has muted. Silence is the correct
 * outcome then; the caller must not fall back to "tell everybody".
 *
 * Falls back to the owner at every dead end, because the owner is the one
 * person who certainly exists and certainly cares.
 */
export function nudgeRecipient(input: NudgeInput): UserId | undefined {
  const { circle, members, lastHappenedAttendees, lastOrganiserId } = input;
  if (circle.status === 'archived' || circle.cadence === 'none') return undefined;

  const active = members.filter(isActive);
  const policy = effectiveNudgePolicy(circle, active.length);
  const nudgeable = members.filter(isNudgeable);
  const eligible = (id: UserId | undefined): UserId | undefined =>
    id !== undefined && nudgeable.some((m) => m.userId === id) ? id : undefined;

  const ownerId = eligible(owner(circle, members));

  switch (policy) {
    case 'owner':
      return ownerId;

    case 'last_organiser':
      return eligible(lastOrganiserId) ?? ownerId;

    case 'take_turns': {
      // Round-robin over the people who were actually there last time, in join
      // order so the rotation is stable and predictable rather than random.
      const attendees = nudgeable
        .filter((m) => lastHappenedAttendees.includes(m.userId))
        .sort((a, b) => compare(a.joinedAt, b.joinedAt) || a.userId.localeCompare(b.userId));

      if (attendees.length === 0) return ownerId;

      // Skip whoever organised last — that is the entire point of taking turns.
      const next = attendees.find((m) => m.userId !== lastOrganiserId);
      // Everyone eligible organised last, i.e. there is only one of them. Asking
      // them again beats asking nobody.
      return (next ?? attendees[0])?.userId ?? ownerId;
    }
  }
}
