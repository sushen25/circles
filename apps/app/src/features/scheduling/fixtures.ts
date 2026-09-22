import type { PlanCandidates, RosterMember } from '../../data/scheduling';

/**
 * Sunday Crew's options, for the gallery and for a build with no backend.
 *
 * The same cast as everywhere else (AGENTS.md, "The scenario"): Maya owns it,
 * Priya, Tom, Jess and Sam have answered, **Alex has not**. These are whole
 * `PlanCandidates` rather than screen props on purpose — the gallery then
 * renders through the real `view.ts`, so a sentence that is wrong on fixtures
 * is wrong in the product too.
 */

const ZONE = 'Australia/Melbourne';

/** Melbourne is UTC+10 in September, so 18:30 local is 08:30Z. */
const THU = { start: '2026-09-17T08:30:00.000Z', end: '2026-09-17T10:30:00.000Z' };
const SAT = { start: '2026-09-19T08:30:00.000Z', end: '2026-09-19T10:30:00.000Z' };
const SUN = { start: '2026-09-20T06:00:00.000Z', end: '2026-09-20T08:00:00.000Z' };
const FRI = { start: '2026-09-11T09:00:00.000Z', end: '2026-09-11T11:00:00.000Z' };
const DEADLINE = '2026-09-15T08:00:00.000Z';

const ROSTER: RosterMember[] = [
  { userId: 'maya', name: 'Maya', active: true },
  { userId: 'priya', name: 'Priya', active: true },
  { userId: 'tom', name: 'Tom', active: true },
  { userId: 'jess', name: 'Jess', active: true },
  { userId: 'sam', name: 'Sam', active: true },
  { userId: 'alex', name: 'Alex', active: true },
];

const EVERYONE = ROSTER.map((m) => m.userId);

const BASE: PlanCandidates = {
  planId: 'thu-17',
  code: 'pnsundaycr',
  circleId: 'sunday-crew',
  circleName: 'Sunday Crew',
  title: 'Catch up',
  zone: ZONE,
  state: 'ready',
  revision: 1,
  inputVersion: 5,
  quorum: 4,
  quorumChosen: false,
  responseDeadline: DEADLINE,
  repliesOpen: true,
  organiserUserId: 'maya',
  me: 'maya',
  isOrganiser: true,
  roster: ROSTER,
  participants: EVERYONE,
  responded: ['maya', 'priya', 'tom', 'jess', 'sam'],
  repliedCount: 5,
  askedCount: 6,
  set: {
    id: 'set-1',
    inputVersion: 5,
    eligibleCount: 7,
    respondedCount: 5,
    activeMemberCount: 6,
  },
  stale: false,
  candidates: [],
  nearMisses: [],
  view: 'collecting',
};

/** Three options, Thursday first. The partial state, which is the common one. */
export const ready: PlanCandidates = {
  ...BASE,
  view: 'ready',
  candidates: [
    {
      id: THU.start,
      startsAt: THU.start,
      endsAt: THU.end,
      rank: 1,
      availableUserIds: ['maya', 'priya', 'tom', 'jess', 'sam'],
      explanationCode: 'best_attendance',
      explanationCount: 5,
      nearMissReason: null,
    },
    {
      id: SAT.start,
      startsAt: SAT.start,
      endsAt: SAT.end,
      rank: 2,
      availableUserIds: ['maya', 'tom', 'jess', 'sam'],
      explanationCode: 'one_fewer_weekend',
      explanationCount: 4,
      nearMissReason: null,
    },
    {
      id: SUN.start,
      startsAt: SUN.start,
      endsAt: SUN.end,
      rank: 3,
      availableUserIds: ['maya', 'priya', 'jess', 'sam'],
      explanationCode: 'also_n_later',
      explanationCount: 4,
      nearMissReason: null,
    },
  ],
};

/** Two answers in, nothing to show yet: the organiser's waiting state. */
export const waiting: PlanCandidates = {
  ...BASE,
  state: 'collecting',
  view: 'collecting',
  responded: ['maya', 'priya'],
  repliedCount: 2,
  set: { ...(BASE.set as NonNullable<PlanCandidates['set']>), respondedCount: 2, eligibleCount: 0 },
};

/** Everybody answered and nothing lined up. The closest it got was three. */
export const noQuorum: PlanCandidates = {
  ...BASE,
  state: 'collecting',
  view: 'no_quorum',
  responded: EVERYONE,
  repliedCount: 6,
  set: { ...(BASE.set as NonNullable<PlanCandidates['set']>), respondedCount: 6, eligibleCount: 0 },
  nearMisses: [
    {
      id: FRI.start,
      startsAt: FRI.start,
      endsAt: FRI.end,
      rank: 1,
      availableUserIds: ['maya', 'priya', 'jess'],
      explanationCode: 'closest',
      explanationCount: 3,
      nearMissReason: { kind: 'quorum_short', by: 1 },
    },
    {
      id: SAT.start,
      startsAt: SAT.start,
      endsAt: SAT.end,
      rank: 2,
      availableUserIds: ['maya', 'tom', 'sam'],
      explanationCode: 'also_n_later',
      explanationCount: 3,
      nearMissReason: { kind: 'quorum_short', by: 1 },
    },
  ],
};

/** The same options, read by somebody who is not organising. */
export const readyAsMember: PlanCandidates = {
  ...ready,
  me: 'priya',
  isOrganiser: false,
};
