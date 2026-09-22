import { describe, expect, it } from 'vitest';

import type { CandidateRow, PlanCandidates, RosterMember } from '../../data/scheduling';
import * as fixture from './fixtures';
import { cardsOf, exceptionOf, headerOf, headlineOf, leadOf, nudgeOf } from './view';

/**
 * The manifesto's test for this screen, as assertions (§3.4): from a card
 * alone, who is coming, who is not, who has not answered, and why it is first.
 */

const ZONE = 'Australia/Melbourne';

function circleOf(size: number): RosterMember[] {
  return Array.from({ length: size }, (_, i) => ({
    userId: `u${i}`,
    name: `M${i}`,
    active: true,
  }));
}

function planWith(overrides: Partial<PlanCandidates>): PlanCandidates {
  return { ...fixture.ready, ...overrides };
}

function rowWith(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    id: '2026-09-17T08:30:00.000Z',
    startsAt: '2026-09-17T08:30:00.000Z',
    endsAt: '2026-09-17T10:30:00.000Z',
    rank: 1,
    availableUserIds: [],
    explanationCode: 'best_attendance',
    explanationCount: 0,
    nearMissReason: null,
    ...overrides,
  };
}

describe('a candidate card', () => {
  it('says who is in, how many, when and why it ranks first', () => {
    const [first] = cardsOf(fixture.ready);
    expect(first?.rank).toBe('Best attendance');
    expect(first?.count).toBe('5 of 6');
    // The device's own date order (manifesto §6), so the parts rather than the order.
    expect(first?.date).toMatch(/Thu/);
    expect(first?.date).toMatch(/17/);
    expect(first?.date).toMatch(/Sep/);
    expect(first?.time).toBe('6:30–8:30 pm');
    expect(first?.members.map((m) => m.name)).toEqual(['Maya', 'Priya', 'Tom', 'Jess', 'Sam']);
    expect(first?.recommended).toBe(true);
  });

  it('tells "has not answered" apart from "does not work"', () => {
    // Priya answered and cannot make the Saturday; Alex has not answered.
    const card = cardsOf(fixture.ready)[1];
    expect(card?.exception).toBe("Doesn't work for Priya · Alex hasn't answered");
  });

  it('names up to three, then counts — at a circle of twenty', () => {
    const roster = circleOf(20);
    const data = planWith({
      roster,
      participants: roster.map((m) => m.userId),
      responded: roster.map((m) => m.userId),
      askedCount: 20,
      repliedCount: 20,
      candidates: [rowWith({ availableUserIds: roster.slice(0, 13).map((m) => m.userId) })],
    });
    const card = cardsOf(data)[0];
    expect(card?.count).toBe('13 of 20');
    expect(card?.exception).toBe('Not M13, M14 and 5 others');
    // Every one of them is in the marks; capping them to a row is the
    // component's job, not this one's (`MARKS_MAX`).
    expect(card?.members.length).toBe(13);
  });

  it('reads sensibly at nobody free, which a near-miss now can be (ADR 0011)', () => {
    const data = planWith({
      candidates: [rowWith({ availableUserIds: [], explanationCode: 'closest' })],
    });
    expect(cardsOf(data)[0]?.count).toBe('Nobody was free');
  });

  it('says nothing about names it cannot read', () => {
    const data = planWith({ responded: null });
    expect(exceptionOf(data, data.candidates[1] as CandidateRow)).toBeUndefined();
  });
});

describe('the header', () => {
  it('dashes the people who have not answered, and never the people who have', () => {
    const header = headerOf(fixture.ready);
    expect(header.members.filter((m) => m.waiting === true).map((m) => m.name)).toEqual(['Alex']);
    expect(header.replied).toBe('5 of 6 replied');
    expect(header.closes).toMatch(/^Closes /);
  });

  it('draws no marks at all when reply state is not readable', () => {
    // A mark with no `waiting` flag is a mark `Marks` fills in, so leaving
    // them in would have told a member who is not allowed to know that
    // everybody had answered — beside "1 of 6 replied".
    const header = headerOf(planWith({ responded: null }));
    expect(header.members).toEqual([]);
    expect(header.marksLabel).toBe('6 people were asked');
    expect(header.replied).toBe('5 of 6 replied');
  });

  it('says replies are closed rather than a deadline that has gone', () => {
    expect(headerOf(planWith({ repliesOpen: false })).closes).toBe('Replies closed');
  });
});

describe('the headline and the lead', () => {
  it('names the day and the number in words', () => {
    expect(headlineOf(fixture.ready)).toBe('Thursday looks good for five of you.');
  });

  it('offers the wait when somebody is still to answer, and not when nobody is', () => {
    expect(leadOf(fixture.ready)).toMatch(/^Alex hasn't answered yet\./);
    expect(nudgeOf(fixture.ready)).toBe('Nudge Alex');

    const everyone = planWith({
      responded: fixture.ready.participants,
      repliedCount: 6,
    });
    expect(leadOf(everyone)).toBe('Everyone has replied. Pick the one that works.');
    expect(nudgeOf(everyone)).toBeUndefined();
  });
});

describe('times', () => {
  it("reads an option in the circle's zone, not the reader's", () => {
    const card = cardsOf(planWith({ zone: ZONE }))[0];
    expect(card?.time).toBe('6:30–8:30 pm');
  });
});
