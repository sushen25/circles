import { describe, expect, it } from 'vitest';

import type { PlanConfirmation } from '../../data/confirmation';
import * as fixture from './fixtures';
import { attendanceStageOf, morningAfterWords, outcomeStageOf } from './morningAfter';

/**
 * Where the morning after stands, read off what the server said (S1-29): the
 * view on the database's clock, the plan's state, the confirmation's status
 * and the reader's own row.
 */

const past = fixture.morningAfter;
const member = fixture.morningAfterAsMember;
const confirmation = past.confirmation!;

function withMine(status: PlanConfirmation['attendance'][number]['status']): PlanConfirmation {
  return {
    ...member,
    attendance: member.attendance.map((a) => (a.userId === 'priya' ? { ...a, status } : a)),
  };
}

describe("the organiser's question", () => {
  it('is asked once the meetup has ended, and not before', () => {
    expect(outcomeStageOf(past)).toBe('ask');
    expect(outcomeStageOf({ ...past, view: 'confirmed' })).toBe('early');
  });

  it('is answered once the plan is completed, whichever of the four it was', () => {
    expect(
      outcomeStageOf({
        ...past,
        state: 'completed',
        confirmation: { ...confirmation, status: 'completed' },
      }),
    ).toBe('answered');
    // "It was cancelled" closes the confirmation as cancelled, on a completed plan.
    expect(
      outcomeStageOf({
        ...past,
        state: 'completed',
        confirmation: { ...confirmation, status: 'cancelled' },
      }),
    ).toBe('answered');
  });

  it('is off for a plan that was reopened, cancelled or never locked in', () => {
    expect(outcomeStageOf({ ...past, view: 'open', state: 'collecting' })).toBe('off');
    expect(outcomeStageOf({ ...past, view: 'over', state: 'cancelled' })).toBe('off');
    expect(outcomeStageOf({ ...past, confirmation: null })).toBe('off');
  });
});

describe("a member's question", () => {
  it('is asked once the meetup has ended, with any earlier answer', () => {
    expect(attendanceStageOf(member)).toEqual({ kind: 'ask', said: undefined });
    expect(attendanceStageOf(withMine('was_there'))).toEqual({ kind: 'ask', said: 'was_there' });
    expect(attendanceStageOf(withMine('missed'))).toEqual({ kind: 'ask', said: 'missed' });
    // A forward-looking answer is not an answer to this question.
    expect(attendanceStageOf(withMine('cant'))).toEqual({ kind: 'ask', said: undefined });
  });

  it('is still asked after the organiser reported it happened', () => {
    const reported = {
      ...member,
      state: 'completed' as const,
      confirmation: { ...confirmation, status: 'completed' as const },
    };
    expect(attendanceStageOf(reported).kind).toBe('ask');
  });

  it('is not asked of somebody the plan never asked', () => {
    const joinedLater = { ...member, me: 'nic' };
    expect(attendanceStageOf(joinedLater).kind).toBe('not_asked');
  });

  it('is early before the end, and off once the organiser says it was cancelled', () => {
    expect(attendanceStageOf({ ...member, view: 'confirmed' }).kind).toBe('early');
    const cancelled = {
      ...member,
      state: 'completed' as const,
      confirmation: { ...confirmation, status: 'cancelled' as const },
    };
    expect(attendanceStageOf(cancelled).kind).toBe('off');
    expect(attendanceStageOf({ ...member, view: 'over' }).kind).toBe('off');
  });
});

describe('the heading', () => {
  it('names the circle, the date and the weekday in the plan’s zone', () => {
    const words = morningAfterWords(past);
    expect(words?.circle).toBe('Sunday Crew');
    expect(words?.day).toBe('Thursday');
    expect(words?.date).toMatch(/17/);
  });
});
