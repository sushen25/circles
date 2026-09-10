/**
 * Builders for the confirmation context.
 *
 * The confirmed artboards are the Sunday Crew's Thursday, so these are built
 * from the scheduling fixtures rather than from hand-typed instants: the
 * confirmation is the engine's own first candidate, which is the only way a
 * test of "5 going · 1 to confirm" is testing the product rather than a number
 * somebody retyped.
 */

import { type UserId, userId } from '../circles/types.js';
import { type Response } from '../availability/types.js';
import { type Plan, planId } from '../planning/types.js';
import { plan as planFixture } from '../planning/fixtures.js';
import { generateCandidates } from '../scheduling/engine.js';
import {
  NEXT_FORTNIGHT,
  SUNDAY_CREW,
  sundayCrewInput,
  sundayCrewResponses,
} from '../scheduling/fixtures.js';
import { type Overrides, build } from '../shared/build.js';
import { type Instant, fromISO } from '../shared/instant.js';
import { toParts, weekday } from '../shared/local-date.js';
import { type Zone, toLocal } from '../shared/zone.js';
import { candidateIdOf } from './confirm.js';
import {
  type Confirmation,
  type ConfirmationId,
  type PlanCandidates,
  confirmationId,
} from './types.js';

export const A_CONFIRMATION_ID: ConfirmationId = confirmationId('confirmation-1');

/** Just after the artboard's plan was created, and well before its Thursday. */
export const CONFIRMED_AT: Instant = fromISO('2026-09-14T09:00:00Z');

/** The plan the Sunday Crew fixtures describe, ready to confirm. */
export function sundayCrewPlan(overrides: Overrides<Plan> = {}): Plan {
  return planFixture({
    id: planId('plan-sunday-crew'),
    state: 'ready',
    organiserUserId: SUNDAY_CREW[0] as UserId,
    window: NEXT_FORTNIGHT.window,
    daily: NEXT_FORTNIGHT.daily,
    quorum: NEXT_FORTNIGHT.quorum,
    requiredMemberIds: [],
    ...overrides,
  });
}

/** The stored candidate set for that plan — the engine's real output. */
export function sundayCrewCandidates(plan: Plan = sundayCrewPlan()): PlanCandidates {
  return {
    planId: plan.id,
    revision: plan.revision,
    inputVersion: plan.inputVersion,
    set: generateCandidates(sundayCrewInput()),
  };
}

/** The id of the artboard's Thursday, the engine's best option. */
export function thursdayId(candidates: PlanCandidates = sundayCrewCandidates()) {
  const best = candidates.set.eligible[0];
  if (best === undefined) throw new Error('fixtures: the Sunday Crew set has no candidates');
  return candidateIdOf(best);
}

/**
 * Thursday 17 September, 6:30–8:30 pm at Hope St Radio — the ConfirmedOrg
 * artboard, with the note it shows.
 */
export function confirmation(overrides: Overrides<Confirmation> = {}): Confirmation {
  const plan = sundayCrewPlan();
  const set = sundayCrewCandidates(plan).set;
  const best = set.eligible[0];
  if (best === undefined) throw new Error('fixtures: the Sunday Crew set has no candidates');

  return build<Confirmation>(
    {
      id: A_CONFIRMATION_ID,
      planId: plan.id,
      revision: plan.revision,
      candidate: {
        start: best.start,
        end: best.end,
        availableUserIds: best.availableUserIds,
      },
      placeName: 'Hope St Radio',
      note: "Table's booked under my name. Come hungry.",
      confirmedBy: SUNDAY_CREW[0] as UserId,
      status: 'active',
      confirmedAt: CONFIRMED_AT,
    },
    overrides,
  );
}

/**
 * The Sunday Crew's answers as stored `Response` rows for one plan revision —
 * the engine fixtures give them in the engine's own shape, which carries no
 * plan or revision.
 */
export function sundayCrewStoredResponses(plan: Plan = sundayCrewPlan()): readonly Response[] {
  return sundayCrewResponses().map(
    ([user, answer]) =>
      ({
        planId: plan.id,
        revision: plan.revision,
        userId: user,
        status: answer.status,
        windows: answer.windows,
        usedCalendarOverlay: false,
        submittedAt: CONFIRMED_AT,
      }) as Response,
  );
}

/** A member who is on no artboard, for "not this circle" cases. */
export const A_STRANGER: UserId = userId('user-stranger');

/**
 * An English formatter for the share messages — the caller's job, so this is a
 * fixture's answer to it rather than a default the module carries.
 *
 * Written out rather than delegated to `Intl`, because the assertions here are
 * about the message templates and an `Intl` short month has changed spelling
 * between ICU versions ("Sep" became "Sept"): a test that broke on a Node
 * upgrade would be testing the runtime, not the product.
 */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const LONG_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const EN_FORMAT = {
  /** "Thu 17 Sep". */
  shortDate: (value: Instant, zone: Zone): string => {
    const date = toLocal(value, zone).date;
    const { month, day } = toParts(date);
    return `${WEEKDAYS[weekday(date) - 1]} ${day} ${MONTHS[month - 1]}`;
  },
  /** "Thursday". */
  weekday: (value: Instant, zone: Zone): string =>
    LONG_WEEKDAYS[weekday(toLocal(value, zone).date) - 1] as string,
} as const;
