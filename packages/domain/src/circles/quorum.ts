/**
 * How many people have to be free before a time counts as workable.
 *
 * The default is a suggestion the organiser can override per plan (spec §5.2).
 * It exists so that nobody has to think about it on the first plan, not to be
 * enforced.
 */

import type { Circle, Member } from './types.js';
import { isActive } from './types.js';

/**
 * Active members per circle (spec §5.2, architecture §6.2).
 *
 * The floor of 3 is what makes the 60% default meaningful — with two people
 * "most of us" is just "both of us". The ceiling of 12 is the point past which
 * a shared availability grid stops being readable and the product is no longer
 * the thing being tested.
 */
export const memberLimits = { min: 3, max: 12 } as const;

/**
 * `max(2, ceil(n × 0.6))` — a clear majority, never fewer than two, because a
 * meetup of one is not a meetup.
 *
 * n=3→2, 4→3, 5→3, 6→4, 8→5, 12→8.
 */
export function quorumDefault(activeMemberCount: number): number {
  if (!Number.isInteger(activeMemberCount) || activeMemberCount < 0) {
    throw new RangeError(`Not a member count: ${activeMemberCount}`);
  }
  return Math.max(2, Math.ceil(activeMemberCount * 0.6));
}

/** The circle's own default, or the computed one when it has not chosen. */
export function quorumFor(circle: Circle, activeMemberCount: number): number {
  return circle.defaultQuorum ?? quorumDefault(activeMemberCount);
}

export function activeMemberCount(members: readonly Member[]): number {
  return members.filter(isActive).length;
}

/**
 * Whether another person can join. The floor is not a barrier to joining — a
 * circle of one is how every circle starts — so only the ceiling applies here.
 */
export function canAddMember(activeCount: number): boolean {
  return activeCount < memberLimits.max;
}

/** Below the floor, quorum defaults are not meaningful yet (architecture §6.2). */
export function hasEnoughMembersForQuorumDefault(activeCount: number): boolean {
  return activeCount >= memberLimits.min;
}
