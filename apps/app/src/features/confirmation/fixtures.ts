import type { PlanConfirmation } from '../../data/confirmation';

/**
 * Sunday Crew, locked in, for the gallery and a build with no backend.
 *
 * The scenario (AGENTS.md): Thursday 17 September, 6:30–8:30 pm at Hope St
 * Radio, in Melbourne. Maya organised; Priya, Tom, Jess and Sam are going and
 * **Alex has not said**, which is the "1 to confirm" the artboards draw. Whole
 * `PlanConfirmation`s rather than screen props, so the gallery renders through
 * the real `confirmed.ts`.
 */

const ROSTER = [
  { userId: 'maya', name: 'Maya', active: true },
  { userId: 'priya', name: 'Priya', active: true },
  { userId: 'tom', name: 'Tom', active: true },
  { userId: 'jess', name: 'Jess', active: true },
  { userId: 'sam', name: 'Sam', active: true },
  { userId: 'alex', name: 'Alex', active: true },
];

export const lockedIn: PlanConfirmation = {
  planId: 'thu-17',
  code: 'pnsundaycr',
  circleId: 'sunday-crew',
  circleName: 'Sunday Crew',
  zone: 'Australia/Melbourne',
  state: 'confirmed',
  organiserUserId: 'maya',
  me: 'maya',
  isOrganiser: true,
  roster: ROSTER,
  confirmation: {
    id: 'confirmation-1',
    // Melbourne is UTC+10 in September, so 18:30 local is 08:30Z.
    startsAt: '2026-09-17T08:30:00.000Z',
    endsAt: '2026-09-17T10:30:00.000Z',
    placeName: 'Hope St Radio',
    placeUrl: undefined,
    note: "Table's booked under my name. Come hungry.",
    status: 'active',
    going: ['maya', 'priya', 'tom', 'jess', 'sam'],
    revision: 1,
    confirmedBy: 'maya',
    confirmedAt: '2026-09-14T09:00:00.000Z',
    ownTime: false,
    belowQuorum: false,
    movedFrom: undefined,
  },
  attendance: [
    { userId: 'maya', status: 'going' },
    { userId: 'priya', status: 'going' },
    { userId: 'tom', status: 'going' },
    { userId: 'jess', status: 'going' },
    { userId: 'sam', status: 'going' },
    { userId: 'alex', status: 'unknown' },
  ],
  view: 'confirmed',
};

/** The same meetup, read by Priya. */
export const lockedInAsMember: PlanConfirmation = {
  ...lockedIn,
  me: 'priya',
  isOrganiser: false,
};

/**
 * The morning after: Thursday has been and gone, and Maya has not said whether
 * it happened. Everybody's forward-looking answer is still what it was.
 */
export const morningAfter: PlanConfirmation = { ...lockedIn, view: 'past' };

/** The same morning, read by Priya, who has not said whether she made it. */
export const morningAfterAsMember: PlanConfirmation = {
  ...morningAfter,
  me: 'priya',
  isOrganiser: false,
};

/**
 * Maya locked in a time of her own (ADR 0051): Friday 18 September, 7–9 pm, which
 * no option offered and which works for two of the six. Priya and Tom put it
 * down, so they are going; everybody else is **to confirm**, Maya included — her
 * own times did not cover it — and nobody is "can't make it", because nobody said
 * no to a time she chose. Melbourne is UTC+10, so 7 pm is 09:00Z.
 */
export const lockedInOwnTime: PlanConfirmation = {
  ...lockedIn,
  confirmation: {
    ...lockedIn.confirmation!,
    id: 'confirmation-own',
    startsAt: '2026-09-18T09:00:00.000Z',
    endsAt: '2026-09-18T11:00:00.000Z',
    going: ['priya', 'tom'],
    ownTime: true,
    belowQuorum: true,
  },
  attendance: [
    { userId: 'maya', status: 'unknown' },
    { userId: 'priya', status: 'going' },
    { userId: 'tom', status: 'going' },
    { userId: 'jess', status: 'unknown' },
    { userId: 'sam', status: 'unknown' },
    { userId: 'alex', status: 'unknown' },
  ],
};

/**
 * Then Maya moved it to Saturday 19 September, 7–9 pm, without asking anybody
 * again. Whoever's times cover it is going with nothing to do (Maya, Tom and
 * Jess); Priya, Sam and Alex are to confirm. It says where it moved from.
 */
export const lockedInMoved: PlanConfirmation = {
  ...lockedInOwnTime,
  confirmation: {
    ...lockedInOwnTime.confirmation!,
    id: 'confirmation-moved',
    startsAt: '2026-09-19T09:00:00.000Z',
    endsAt: '2026-09-19T11:00:00.000Z',
    going: ['maya', 'tom', 'jess'],
    belowQuorum: true,
    movedFrom: { startsAt: '2026-09-18T09:00:00.000Z', endsAt: '2026-09-18T11:00:00.000Z' },
  },
  attendance: [
    { userId: 'maya', status: 'going' },
    { userId: 'priya', status: 'unknown' },
    { userId: 'tom', status: 'going' },
    { userId: 'jess', status: 'going' },
    { userId: 'sam', status: 'unknown' },
    { userId: 'alex', status: 'unknown' },
  ],
};

/** The moved plan, read by Priya, who is asked whether she can come. */
export const lockedInMovedAsMember: PlanConfirmation = {
  ...lockedInMoved,
  me: 'priya',
  isOrganiser: false,
};
