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
  member({ userId: 'priya' }),
  member({ userId: 'sam', savedPlace: false, joinedAt: '2026-09-04T12:00:00Z' }),
];

const detailOf = (rows: ReturnType<typeof memberRows>, id: string) =>
  rows.find((r) => r.userId === id)?.detail;

describe('the detail line on a member row (SUS-165)', () => {
  it('says the tier before the date, to the owner', () => {
    const rows = memberRows(home('maya', ROSTER));
    expect(detailOf(rows, 'maya')).toBe('You · owner');
    expect(detailOf(rows, 'priya')).toMatch(/^Place saved · joined .*\b3\b/);
    expect(detailOf(rows, 'sam')).toMatch(/^Guest · joined .*\b4\b/);
  });

  it('says it to everybody else too, not only the owner', () => {
    const rows = memberRows(home('priya', ROSTER));
    expect(detailOf(rows, 'maya')).toBe('Owner');
    expect(detailOf(rows, 'priya')).toBe('You · place saved');
    expect(detailOf(rows, 'sam')).toMatch(/^Guest · joined .*\b4\b/);
  });

  it('says "You · guest" on a guest’s own row', () => {
    const rows = memberRows(home('sam', ROSTER));
    expect(detailOf(rows, 'sam')).toBe('You · guest');
    expect(detailOf(rows, 'priya')).toMatch(/^Place saved · joined .*\b3\b/);
  });

  it('never calls an owner a guest, whatever the flag says', () => {
    const rows = memberRows(
      home('priya', [
        member({ userId: 'maya', role: 'owner', savedPlace: false }),
        ...ROSTER.slice(1),
      ]),
    );
    expect(detailOf(rows, 'maya')).toBe('Owner');
  });
});
