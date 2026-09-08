import { describe, expect, it } from 'vitest';

import {
  activeMemberCount,
  canAddMember,
  hasEnoughMembersForQuorumDefault,
  memberLimits,
  quorumDefault,
  quorumFor,
} from './quorum.js';
import { member } from './fixtures.js';
import { circle } from './fixtures.js';

describe('quorumDefault', () => {
  // The table from the ticket, verbatim. These are the numbers a person sees.
  it.each([
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [8, 5],
    [12, 8],
  ])('%i active members needs %i', (members, expected) => {
    expect(quorumDefault(members)).toBe(expected);
  });

  it('never asks for fewer than two, because a meetup of one is not a meetup', () => {
    expect(quorumDefault(0)).toBe(2);
    expect(quorumDefault(1)).toBe(2);
    expect(quorumDefault(2)).toBe(2);
  });

  it('rejects a count that is not a count', () => {
    expect(() => quorumDefault(-1)).toThrow(RangeError);
    expect(() => quorumDefault(2.5)).toThrow(RangeError);
  });
});

describe('quorumFor', () => {
  it("prefers the circle's own choice over the computed default", () => {
    expect(quorumFor(circle({ defaultQuorum: 2 }), 12)).toBe(2);
  });

  it('computes when the circle has not chosen', () => {
    expect(quorumFor(circle(), 6)).toBe(4);
  });
});

describe('membership limits', () => {
  it('counts only active members', () => {
    const members = [member(), member({ status: 'removed' }), member()];
    expect(activeMemberCount(members)).toBe(2);
  });

  it('lets people join right up to the ceiling', () => {
    expect(canAddMember(memberLimits.max - 1)).toBe(true);
    expect(canAddMember(memberLimits.max)).toBe(false);
  });

  it('does not treat the floor as a barrier to joining — every circle starts at one', () => {
    expect(canAddMember(1)).toBe(true);
    expect(hasEnoughMembersForQuorumDefault(2)).toBe(false);
    expect(hasEnoughMembersForQuorumDefault(3)).toBe(true);
  });
});
