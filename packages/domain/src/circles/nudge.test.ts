import { describe, expect, it } from 'vitest';

import { fromISO } from '../shared/instant.js';
import { effectiveNudgePolicy, nudgeChoice, nudgeHeld, nudgeRecipient } from './nudge.js';
import { OWNER, circle, member } from './fixtures.js';
import { type UserId, userId } from './types.js';

const ann = userId('ann');
const bo = userId('bo');
const cy = userId('cy');

/** Joined in alphabetical order, an hour apart, so rotation order is testable. */
function crew() {
  return [
    member({ userId: OWNER, role: 'owner', joinedAt: fromISO('2026-01-01T00:00:00Z') }),
    member({ userId: ann, joinedAt: fromISO('2026-01-01T01:00:00Z') }),
    member({ userId: bo, joinedAt: fromISO('2026-01-01T02:00:00Z') }),
    member({ userId: cy, joinedAt: fromISO('2026-01-01T03:00:00Z') }),
  ];
}

const everyone: readonly UserId[] = [OWNER, ann, bo, cy];

describe('effectiveNudgePolicy', () => {
  it('takes turns once there are four or more, so one person is not always organising', () => {
    expect(effectiveNudgePolicy(circle(), 4)).toBe('take_turns');
    expect(effectiveNudgePolicy(circle(), 12)).toBe('take_turns');
  });

  it('falls to the owner below four, where there is nobody to take turns with', () => {
    expect(effectiveNudgePolicy(circle(), 3)).toBe('owner');
    expect(effectiveNudgePolicy(circle(), 1)).toBe('owner');
  });

  it('never overrides an explicit choice', () => {
    expect(effectiveNudgePolicy(circle({ nudgePolicy: 'owner' }), 12)).toBe('owner');
    expect(effectiveNudgePolicy(circle({ nudgePolicy: 'take_turns' }), 2)).toBe('take_turns');
  });
});

describe('nudgeRecipient', () => {
  it('asks the owner under the owner policy', () => {
    const got = nudgeRecipient({
      circle: circle({ nudgePolicy: 'owner' }),
      members: crew(),
      lastHappenedAttendees: everyone,
      lastOrganiserId: ann,
    });
    expect(got).toBe(OWNER);
  });

  it('asks whoever organised last under that policy', () => {
    const got = nudgeRecipient({
      circle: circle({ nudgePolicy: 'last_organiser' }),
      members: crew(),
      lastHappenedAttendees: everyone,
      lastOrganiserId: bo,
    });
    expect(got).toBe(bo);
  });

  it('falls back to the owner when the last organiser has since left', () => {
    const members = crew().map((m) => (m.userId === bo ? { ...m, status: 'removed' as const } : m));
    const got = nudgeRecipient({
      circle: circle({ nudgePolicy: 'last_organiser' }),
      members,
      lastHappenedAttendees: everyone,
      lastOrganiserId: bo,
    });
    expect(got).toBe(OWNER);
  });

  describe('take turns', () => {
    const taking = circle({ nudgePolicy: 'take_turns' });

    it('is deterministic: join order, so the rotation is predictable', () => {
      const got = nudgeRecipient({
        circle: taking,
        members: crew(),
        lastHappenedAttendees: everyone,
      });
      expect(got).toBe(OWNER); // earliest joined
    });

    it('skips whoever organised last, which is the point of taking turns', () => {
      const got = nudgeRecipient({
        circle: taking,
        members: crew(),
        lastHappenedAttendees: everyone,
        lastOrganiserId: OWNER,
      });
      expect(got).toBe(ann);
    });

    it('only asks people who were actually there last time', () => {
      const got = nudgeRecipient({
        circle: taking,
        members: crew(),
        lastHappenedAttendees: [bo, cy],
        lastOrganiserId: bo,
      });
      expect(got).toBe(cy);
    });

    it('skips someone who has muted everything', () => {
      const members = crew().map((m) => (m.userId === ann ? { ...m, mutedAll: true } : m));
      const got = nudgeRecipient({
        circle: taking,
        members,
        lastHappenedAttendees: everyone,
        lastOrganiserId: OWNER,
      });
      expect(got).toBe(bo);
    });

    it('skips an anonymous member, who has nowhere to receive a nudge', () => {
      const members = crew().map((m) => (m.userId === ann ? { ...m, isPermanent: false } : m));
      const got = nudgeRecipient({
        circle: taking,
        members,
        lastHappenedAttendees: everyone,
        lastOrganiserId: OWNER,
      });
      expect(got).toBe(bo);
    });

    it('falls back to the owner when nobody attended the last meetup', () => {
      const got = nudgeRecipient({
        circle: taking,
        members: crew(),
        lastHappenedAttendees: [],
        lastOrganiserId: ann,
      });
      expect(got).toBe(OWNER);
    });

    it('asks the only eligible person again rather than asking nobody', () => {
      const got = nudgeRecipient({
        circle: taking,
        members: crew(),
        lastHappenedAttendees: [bo],
        lastOrganiserId: bo,
      });
      expect(got).toBe(bo);
    });
  });

  describe('"Nudges to plan the next one" turned off', () => {
    const off = (who: UserId) =>
      crew().map((m) => (m.userId === who ? { ...m, mutedNudges: true } : m));

    it('asks nobody under the owner policy when the owner said no', () => {
      const got = nudgeRecipient({
        circle: circle({ nudgePolicy: 'owner' }),
        members: off(OWNER),
        lastHappenedAttendees: everyone,
        lastOrganiserId: ann,
      });
      expect(got).toBeUndefined();
    });

    it('asks nobody when the last organiser said no, rather than handing it to the owner', () => {
      const got = nudgeRecipient({
        circle: circle({ nudgePolicy: 'last_organiser' }),
        members: off(bo),
        lastHappenedAttendees: everyone,
        lastOrganiserId: bo,
      });
      expect(got).toBeUndefined();
    });

    it('passes the turn on under take turns', () => {
      const got = nudgeRecipient({
        circle: circle({ nudgePolicy: 'take_turns' }),
        members: off(ann),
        lastHappenedAttendees: everyone,
        lastOrganiserId: OWNER,
      });
      expect(got).toBe(bo);
    });

    it('lets the owner fall back only while the owner has not said no too', () => {
      const members = crew().map((m) => ({ ...m, mutedNudges: m.userId !== OWNER }));
      const taking = circle({ nudgePolicy: 'take_turns' });
      const input = { circle: taking, lastHappenedAttendees: [ann, bo, cy], lastOrganiserId: ann };
      expect(nudgeChoice({ ...input, members })).toEqual({
        userId: OWNER,
        role: 'owner_fallback',
      });
      const everyoneOff = crew().map((m) => ({ ...m, mutedNudges: true }));
      expect(nudgeRecipient({ ...input, members: everyoneOff })).toBeUndefined();
    });
  });

  describe('take turns over several cycles', () => {
    it('rotates through everybody, not the same two in alternation', () => {
      // Each cycle, whoever was asked organises the next meetup, everyone comes.
      const taking = circle({ nudgePolicy: 'take_turns' });
      const asked: (UserId | undefined)[] = [];
      let lastOrganiserId: UserId | undefined = OWNER;
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const next = nudgeRecipient({
          circle: taking,
          members: crew(),
          lastHappenedAttendees: everyone,
          lastOrganiserId,
        });
        asked.push(next);
        lastOrganiserId = next;
      }
      expect(asked).toEqual([ann, bo, cy, OWNER]);
    });

    it('carries on from a last organiser who has since left', () => {
      const members = crew().map((m) =>
        m.userId === bo ? { ...m, status: 'removed' as const } : m,
      );
      const got = nudgeRecipient({
        circle: circle({ nudgePolicy: 'take_turns' }),
        members,
        lastHappenedAttendees: everyone,
        lastOrganiserId: bo,
      });
      expect(got).toBe(cy);
    });

    it('says why: the policy, or the owner as a fallback', () => {
      const taking = circle({ nudgePolicy: 'take_turns' });
      expect(
        nudgeChoice({
          circle: taking,
          members: crew(),
          lastHappenedAttendees: [],
          lastOrganiserId: ann,
        }),
      ).toEqual({ userId: OWNER, role: 'owner_fallback' });
      expect(
        nudgeChoice({
          circle: taking,
          members: crew(),
          lastHappenedAttendees: everyone,
          lastOrganiserId: ann,
        }),
      ).toEqual({ userId: bo, role: 'take_turns' });
      expect(
        nudgeChoice({
          circle: circle({ nudgePolicy: 'owner' }),
          members: crew(),
          lastHappenedAttendees: everyone,
        }),
      ).toEqual({ userId: OWNER, role: 'owner' });
    });
  });

  it('says nothing for an archived circle', () => {
    const got = nudgeRecipient({
      circle: circle({ status: 'archived' }),
      members: crew(),
      lastHappenedAttendees: everyone,
      lastOrganiserId: ann,
    });
    expect(got).toBeUndefined();
  });

  it('says nothing when the circle set no goal', () => {
    const got = nudgeRecipient({
      circle: circle({ cadence: 'none' }),
      members: crew(),
      lastHappenedAttendees: everyone,
      lastOrganiserId: ann,
    });
    expect(got).toBeUndefined();
  });

  it('says nothing rather than telling everybody when all have muted', () => {
    const members = crew().map((m) => ({ ...m, mutedAll: true }));
    const got = nudgeRecipient({
      circle: circle({ nudgePolicy: 'take_turns' }),
      members,
      lastHappenedAttendees: everyone,
      lastOrganiserId: undefined,
    });
    expect(got).toBeUndefined();
  });
});

describe('nudgeHeld', () => {
  // Monthly, last met 8 August: about time from 1 September 18:30 Melbourne.
  const now = fromISO('2026-09-03T00:00:00Z');
  const ann0 = () => crew().find((m) => m.userId === ann);

  it('lets a nudge that is still owed go', () => {
    expect(
      nudgeHeld({ circle: circle(), member: ann0(), now, hasOpenPlan: false }),
    ).toBeUndefined();
  });

  it('holds it for somebody who has left, or who turned nudges off since', () => {
    const member = ann0();
    if (member === undefined) throw new Error('fixture');
    expect(
      nudgeHeld({
        circle: circle(),
        member: { ...member, status: 'removed' },
        now,
        hasOpenPlan: false,
      }),
    ).toBe('not_a_member');
    expect(nudgeHeld({ circle: circle(), member: undefined, now, hasOpenPlan: false })).toBe(
      'not_a_member',
    );
    expect(
      nudgeHeld({
        circle: circle(),
        member: { ...member, mutedNudges: true },
        now,
        hasOpenPlan: false,
      }),
    ).toBe('nudges_off');
    expect(
      nudgeHeld({
        circle: circle(),
        member: { ...member, mutedAll: true },
        now,
        hasOpenPlan: false,
      }),
    ).toBe('nudges_off');
  });

  it('holds it once a plan is running, the owner snoozed, or the circle met again', () => {
    const member = ann0();
    expect(nudgeHeld({ circle: circle(), member, now, hasOpenPlan: true })).toBe('no_longer_due');
    const snoozed = circle({ cadenceSnoozedUntil: fromISO('2026-10-01T00:00:00Z') });
    expect(nudgeHeld({ circle: snoozed, member, now, hasOpenPlan: false })).toBe('no_longer_due');
    const metAgain = circle({ lastMetAt: fromISO('2026-09-02T08:30:00Z') });
    expect(nudgeHeld({ circle: metAgain, member, now, hasOpenPlan: false })).toBe('no_longer_due');
  });
});
