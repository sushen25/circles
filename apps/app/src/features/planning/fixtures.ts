import type { PlanDetails } from '../../data/planning';
import type { FormContext } from './usePlanForm';

/**
 * Sunday Crew, for the plan screens in the gallery and in a build with no
 * backend (AGENTS.md, "The scenario"): Maya organises, Priya, Tom, Jess and
 * Sam have answered, Alex has not, and Thursday 17 September 6:30–8:30 pm is
 * the time. Whole `PlanDetails` rather than screen props, so the gallery goes
 * through the same sentences the product does.
 *
 * **The clock is fixed** at Tuesday 15 September, 10 am in Melbourne: the
 * fixtures' dates are the scenario's, and judged against today's date every
 * window in them would have gone by.
 */
export const FIXTURE_NOW = Date.parse('2026-09-15T00:00:00.000Z');

const ZONE = 'Australia/Melbourne';

const ROSTER = [
  { userId: 'maya', name: 'Maya', active: true },
  { userId: 'priya', name: 'Priya', active: true },
  { userId: 'tom', name: 'Tom', active: true },
  { userId: 'jess', name: 'Jess', active: true },
  { userId: 'sam', name: 'Sam', active: true },
  { userId: 'alex', name: 'Alex', active: true },
];

export const sundayCrew: FormContext = {
  zone: ZONE,
  people: ROSTER.map((m) => ({ id: m.userId, name: m.name })),
  me: 'maya',
  members: ROSTER.length,
  quorumShown: 4,
  quorumFollows: true,
};

/** Asking, with five answers in: the plan EditPlan opens on. */
export const asking: PlanDetails = {
  planId: 'thu-17',
  code: 'pnsundaycr',
  circleId: 'sunday-crew',
  circleName: 'Sunday Crew',
  zone: ZONE,
  state: 'ready',
  title: 'Catch up',
  category: 'catch_up',
  revision: 1,
  windowStart: '2026-09-14',
  windowEnd: '2026-09-20',
  band: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  quorum: 4,
  quorumChosen: false,
  responseDeadline: '2026-09-15T08:00:00.000Z',
  deadlinePassed: false,
  cancelNote: undefined,
  organiserUserId: 'maya',
  me: 'maya',
  isOrganiser: true,
  isOwner: true,
  ownerUserId: 'maya',
  roster: ROSTER,
  participants: ROSTER.map((m) => m.userId),
  required: ['maya'],
  lastConfirmation: null,
};

/** Locked in for Thursday: what ChangeTime and CancelPlan open on. */
export const lockedIn: PlanDetails = {
  ...asking,
  state: 'confirmed',
  lastConfirmation: {
    startsAt: '2026-09-17T08:30:00.000Z',
    endsAt: '2026-09-17T10:30:00.000Z',
    status: 'active',
    revision: 1,
  },
};

/** Called off, with Maya's note. */
export const cancelled: PlanDetails = {
  ...lockedIn,
  state: 'cancelled',
  cancelNote: 'Work thing came up, sorry all. Will try again in October.',
  lastConfirmation: { ...lockedIn.lastConfirmation!, status: 'cancelled' },
};

/** Reopened for the week after, as a member sees it. */
export const reopened: PlanDetails = {
  ...asking,
  state: 'collecting',
  revision: 2,
  windowStart: '2026-09-21',
  windowEnd: '2026-09-27',
  me: 'priya',
  isOrganiser: false,
  isOwner: false,
  lastConfirmation: { ...lockedIn.lastConfirmation!, status: 'superseded' },
};

/** The same cancellation, as Priya reads it on the plan's link. */
export const cancelledAsMember: PlanDetails = {
  ...cancelled,
  me: 'priya',
  isOrganiser: false,
  isOwner: false,
};
