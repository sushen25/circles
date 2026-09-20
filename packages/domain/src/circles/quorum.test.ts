import { describe, expect, it } from 'vitest';

import {
  activeMemberCount,
  canAddMember,
  hasEnoughMembersForQuorumDefault,
  memberLimits,
  quorumDefault,
  quorumFor,
  softQuorum,
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
    // The cap, which moved from 12 to 20 in ADR 0012. The formula is unchanged:
    // 60% of twenty is the same proportion it is of every other size.
    [20, 12],
  ])('%i active members needs %i', (members, expected) => {
    expect(quorumDefault(members)).toBe(expected);
  });

  it('asks for a majority at the cap, not a quorum frozen at the old one', () => {
    expect(quorumDefault(memberLimits.max)).toBe(12);
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

describe('a defaulted quorum, while it follows the circle (ADR 0026)', () => {
  it('never lets a brand-new circle reach quorum on two people', () => {
    // The whole point of the floor: first run plans on a circle of one.
    expect(quorumDefault(1)).toBe(2);
    expect(quorumDefault(2)).toBe(2);
    expect(softQuorum(1)).toBe(3);
    expect(softQuorum(2)).toBe(3);
  });

  it('is the floor until the majority passes it, then the majority', () => {
    expect(softQuorum(3)).toBe(3);
    expect(softQuorum(4)).toBe(3);
    expect(softQuorum(5)).toBe(3);
    expect(softQuorum(6)).toBe(4);
    expect(softQuorum(8)).toBe(5);
    expect(softQuorum(12)).toBe(8);
  });

  it('is the floor the circle already names, not a second number', () => {
    expect(softQuorum(0)).toBe(memberLimits.min);
  });

  it('refuses a count that is not one', () => {
    expect(() => softQuorum(-1)).toThrow(RangeError);
    expect(() => softQuorum(1.5)).toThrow(RangeError);
  });
});
