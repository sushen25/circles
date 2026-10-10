import { describe, expect, it } from 'vitest';

import type { CircleHome, HomeMember } from '../../data/circles';
import { memberRows } from './settingsWords';

const member = (over: Partial<HomeMember> & Pick<HomeMember, 'userId'>): HomeMember => ({
  name: over.userId,
  joinedAt: '2026-09-03T12:00:00Z',
  role: 'member',
  savedPlace: true,
  ...over,
});

const home = (me: string, members: HomeMember[]): CircleHome =>
  ({
    zone: 'Australia/Melbourne',
    isOwner: me === 'maya',
    me,
    members,
  }) as unknown as CircleHome;

const ROSTER = [
  member({ userId: 'maya', role: 'owner' }),
  member({ userId: 'nina' }),
  member({ userId: 'sam', savedPlace: false, joinedAt: '2026-09-04T12:00:00Z' }),
];

const detailOf = (rows: ReturnType<typeof memberRows>, id: string) =>
  rows.find((r) => r.userId === id)?.detail;

describe('the detail line on a member row (SUS-165)', () => {
  it('says the tier before the date, to the owner', () => {
    const rows = memberRows(home('maya', ROSTER));
    expect(detailOf(rows, 'maya')).toBe('You · owner');
    expect(detailOf(rows, 'nina')).toMatch(/^Place saved · joined .*\b3\b/);
    expect(detailOf(rows, 'sam')).toMatch(/^Guest · joined .*\b4\b/);
  });

  it('says only when they joined on another member’s row, whatever the member', () => {
    // A member is not told who else has a saved place (ADR 0060): the data
    // carries null for everybody but themselves.
    const asNina = [
      member({ userId: 'maya', role: 'owner' }),
      member({ userId: 'nina' }),
      member({ userId: 'sam', savedPlace: null, joinedAt: '2026-09-04T12:00:00Z' }),
    ];
    const rows = memberRows(home('nina', asNina));
    expect(detailOf(rows, 'maya')).toBe('Owner');
    expect(detailOf(rows, 'nina')).toBe('You · place saved');
    expect(detailOf(rows, 'sam')).toMatch(/^Joined .*\b4\b/);
  });

  it('says "You · guest" on a guest’s own row, and only joined on the rest', () => {
    const asSam = [
      member({ userId: 'maya', role: 'owner' }),
      member({ userId: 'nina', savedPlace: null }),
      member({ userId: 'sam', savedPlace: false }),
    ];
    const rows = memberRows(home('sam', asSam));
    expect(detailOf(rows, 'sam')).toBe('You · guest');
    expect(detailOf(rows, 'nina')).toMatch(/^Joined .*\b3\b/);
  });

  it('never calls an owner a guest, whatever the flag says', () => {
    const rows = memberRows(
      home('nina', [
        member({ userId: 'maya', role: 'owner', savedPlace: false }),
        ...ROSTER.slice(1),
      ]),
    );
    expect(detailOf(rows, 'maya')).toBe('Owner');
  });
});
