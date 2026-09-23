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
