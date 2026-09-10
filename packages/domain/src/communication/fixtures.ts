/**
 * Builders for the communication context.
 *
 * The Sunday Crew again, as `Member` rows this time: eligibility is about
 * membership — active, permanent, muted — and the scheduling fixtures carry
 * only ids.
 */

import { type Member, type UserId, userId } from '../circles/types.js';
import { circle as circleFixture, member as memberFixture } from '../circles/fixtures.js';
import { type Overrides, build } from '../shared/build.js';
import { fromISO } from '../shared/instant.js';
import { ALEX, JESS, NIC, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { sundayCrewPlan, sundayCrewStoredResponses } from '../confirmation/fixtures.js';
import type { EligibilityContext } from './eligibility.js';

const NAMES: Readonly<Record<string, string>> = {
  [SAM]: 'Sam',
  [PRIYA]: 'Priya',
  [TOM]: 'Tom',
  [JESS]: 'Jess',
  [NIC]: 'Nic',
  [ALEX]: 'Alex',
};

/** The six, as active permanent members of `circle-1`, in the list's order. */
export function sundayCrewMembers(overrides: Partial<Record<UserId, Overrides<Member>>> = {}) {
  return SUNDAY_CREW.map((id, index) =>
    memberFixture({
      userId: id,
      displayName: NAMES[id] ?? `Member ${index + 1}`,
      role: id === SAM ? 'owner' : 'member',
      joinedAt: fromISO(`2026-0${index + 1}-01T00:00:00Z`),
      ...overrides[id],
    }),
  );
}

/** Everybody has the app, which is the case each audience rule is written for. */
export const EVERYONE_HAS_PUSH = () => true;
export const NOBODY_HAS_PUSH = () => false;

/** Nobody asked to be emailed about this plan, which is the default state. */
export const NOBODY_SUBSCRIBED = () => false;
export const EVERYONE_SUBSCRIBED = () => true;

/**
 * A context for the artboard's plan: six members, five answered, Alex has not.
 * `circle-1`'s owner is Sam, and Sam is the organiser.
 */
export function eligibilityContext(
  overrides: Overrides<EligibilityContext> = {},
): EligibilityContext {
  const plan = sundayCrewPlan();
  return build<EligibilityContext>(
    {
      circle: circleFixture({ ownerUserId: SAM }),
      plan,
      members: sundayCrewMembers(),
      responses: sundayCrewStoredResponses(plan),
      participantIds: SUNDAY_CREW,
      hasPushDevice: EVERYONE_HAS_PUSH,
    },
    overrides,
  );
}

/** Somebody who is not in the circle at all. */
export const AN_OUTSIDER: UserId = userId('user-outsider');
