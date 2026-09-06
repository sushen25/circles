import { fixtures as domain } from '@circles/domain';

/**
 * The Sunday Crew scenario — the one the whole canvas is drawn around.
 *
 * Maya owns the circle. Priya, Tom, Jess and Sam have answered; **Alex has
 * not**, which is the point: the partial state is the most common real one and
 * every screen has to read well in it (manifesto §7).
 *
 * Slice 1 replaces these with data from Supabase. Until then they are what
 * makes the journey clickable with no network at all.
 */
export type Member = { name: string; waiting?: boolean };

export type Fixture = {
  name: string;
  circle: {
    name: string;
    members: Member[];
    memberCount: number;
  };
  plan: {
    dayLabel: string;
    /** Ten half-hour cells, from 5:30 pm. */
    cells: boolean[];
    busy: number[];
    ticks: string[];
    startMinutes: number;
    answered: number;
    invited: number;
  };
};

const EVENING_START = 17 * 60 + 30;

const SUNDAY_CREW: Member[] = [
  { name: 'Maya' },
  { name: 'Priya' },
  { name: 'Tom' },
  { name: 'Jess' },
  { name: 'Sam' },
  { name: 'Alex', waiting: true },
];

/** The ordinary case: some answers in, one person still to reply. */
export const partial: Fixture = {
  name: 'partial',
  circle: { name: 'Sunday Crew', members: SUNDAY_CREW, memberCount: 6 },
  plan: {
    dayLabel: 'Thu 17 Sep',
    cells: [false, false, true, true, true, true, true, true, true, true],
    busy: [0, 1],
    ticks: ['5:30 pm', '8 pm', '10:30 pm'],
    startMinutes: EVENING_START,
    answered: 5,
    invited: 6,
  },
};

/** Nobody has answered yet. Should teach, not apologise. */
export const empty: Fixture = {
  ...partial,
  name: 'empty',
  circle: {
    name: 'Sunday Crew',
    members: SUNDAY_CREW.map((m) => ({ ...m, waiting: true })),
    memberCount: 6,
  },
  plan: { ...partial.plan, cells: new Array(10).fill(false), answered: 0 },
};

/** Everyone is in. */
export const complete: Fixture = {
  ...partial,
  name: 'complete',
  circle: {
    name: 'Sunday Crew',
    members: SUNDAY_CREW.map(({ name }) => ({ name })),
    memberCount: 6,
  },
  plan: { ...partial.plan, answered: 6 },
};

export const FIXTURES = { partial, empty, complete } as const;
export type FixtureName = keyof typeof FIXTURES;

export const DEFAULT_FIXTURE: FixtureName = 'partial';

export function fixtureByName(name: string | undefined): Fixture {
  return FIXTURES[(name ?? DEFAULT_FIXTURE) as FixtureName] ?? FIXTURES[DEFAULT_FIXTURE];
}

/** Re-exported so screens and tests share one source of scenario data. */
export const domainFixtures = domain;
