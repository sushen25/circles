import { describe, expect, it } from 'vitest';

import type { CircleHome } from '../../data/circles';
import { nextOne } from './words';

const DUE: CircleHome = {
  id: 'c',
  name: 'Sunday Crew',
  color: 'clay',
  status: 'active',
  nudgePolicy: null,
  defaultArea: null,
  cadence: 'monthly',
  zone: 'Australia/Melbourne',
  lastMetAt: '2026-08-01T08:00:00Z',
  cadenceSnoozedUntil: null,
  defaultDurationMinutes: 120,
  defaultQuorum: null,
  isOwner: true,
  me: 'maya',
  members: [],
  activePlan: null,
  lockedIn: null,
  morningAfter: null,
  myTurn: false,
  mine: null,
};

describe('"Next one" on the circle home', () => {
  const now = new Date('2026-09-10T00:00:00Z');

  it('says a circle is due when it is', () => {
    expect(nextOne(DUE, now)).toBe('Due soon');
  });

  it('says no rush once a plan is already out, as the domain decides (review round 1)', () => {
    const planned = {
      ...DUE,
      activePlan: {
        id: 'p',
        code: 'abcdefgh',
        organiserUserId: 'maya',
        title: 'Catch up',
        responseDeadline: '2026-09-12T08:00:00Z',
        replied: 0,
        asked: 3,
      },
    };
    expect(nextOne(planned, now)).toBe('No rush');
  });
});
