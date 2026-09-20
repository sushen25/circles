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
 * "most of us" is just "both of us". The ceiling of 20 is a group you can still
 * hold in your head, and it is a product rule rather than a technical one: it
 * moved from 12 through [ADR 0012](../../../../docs/decisions/0012-circle-member-cap-of-twenty.md),
 * because twelve was splitting book clubs and extended families into two
 * circles and halving the availability the engine works from.
 *
 * `public.member_cap()` is the other copy of this number, in SQL. Both are
 * named rather than inline, and the pgTAP suite fills a circle to exactly
 * `member_cap()` so the two cannot drift in silence.
 */
export const memberLimits = { min: 3, max: 20 } as const;

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

/**
 * Whether a plan's quorum is the organiser's number or a placeholder.
 *
 * `chosen` is a number somebody meant: the request carried one, or the circle
 * has a default. `defaulted` is what a plan gets when nobody has said, and it is
 * the only one that moves on its own ([ADR 0026](../../../../docs/decisions/0026-first-run-shares-a-plan-and-a-defaulted-quorum-follows-the-circle.md)).
 */
export type QuorumSource = 'chosen' | 'defaulted';

/**
 * The quorum a plan carries while nobody has chosen one: `quorumDefault`, never
 * below the floor that makes a default meaningful at all.
 *
 * First run makes a plan on a circle of **one** — the organiser, seconds after
 * making the circle — and shares the plan's link rather than an invite (ADR
 * 0026). `quorumDefault(1)` is 2 and `quorumDefault(2)` is 2, so without the
 * floor the first friend to answer would take the plan to `ready` and the
 * organiser would be shown a best time for two people while the rest of the
 * chat was still reading the message.
 *
 * `memberLimits.min` is the same 3 that makes the 60% default meaningful, used
 * here as a floor rather than a target: 1→3, 3→3, 5→3, 6→4, 8→5, 12→8.
 *
 * `public.soft_quorum()` is the other copy, in SQL, and is the authoritative
 * one — this is a transition guard, so it exists in both places by design
 * (AGENTS.md, architecture §6.4). A pgTAP test walks the same counts.
 */
export function softQuorum(activeMemberCount: number): number {
  return Math.max(memberLimits.min, quorumDefault(activeMemberCount));
}
