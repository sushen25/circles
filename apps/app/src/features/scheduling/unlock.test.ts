import { fromISO } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import type { PlanCandidates } from '../../data/scheduling';
import * as fixture from './fixtures';
import { blockedBy, lowerTarget, unlocksOf, widerWindow } from './unlock';

function planWith(overrides: Partial<PlanCandidates>): PlanCandidates {
  return { ...fixture.noQuorum, ...overrides };
}

function missWith(
  available: string[],
  reason: PlanCandidates['nearMisses'][number]['nearMissReason'],
) {
  return {
    id: '2026-09-11T09:00:00.000Z',
    startsAt: '2026-09-11T09:00:00.000Z',
    endsAt: '2026-09-11T11:00:00.000Z',
    rank: 1,
    availableUserIds: available,
    explanationCode: 'closest' as const,
    explanationCount: available.length,
    nearMissReason: reason,
  };
}

describe('what would unlock it', () => {
  it('offers the number that unlocks the closest time', () => {
    expect(lowerTarget(fixture.noQuorum)).toBe(3);
    const lower = unlocksOf(fixture.noQuorum).find((u) => u.kind === 'lower');
    expect(lower?.title).toBe('Lower to 3 people');
    // ADR 0026: the copy has to say the number stops following the circle.
    expect(lower?.body).toContain('keeps 3 as its number');
  });

  it('never offers to lower to nobody, which a zero-of-N near-miss would (ADR 0011)', () => {
    const data = planWith({
      nearMisses: [missWith([], { kind: 'quorum_short', by: 4 })],
    });
    expect(lowerTarget(data)).toBeUndefined();
    expect(unlocksOf(data).map((u) => u.kind)).toEqual(['wider', 'close']);
  });

  it('never offers to lower to one: a meetup of one is not a meetup', () => {
    const data = planWith({
      nearMisses: [missWith(['maya'], { kind: 'quorum_short', by: 3 })],
    });
    expect(lowerTarget(data)).toBeUndefined();
  });

  it('never offers a number that is not lower than the one in force', () => {
    expect(lowerTarget(planWith({ quorum: 3 }))).toBeUndefined();
    expect(lowerTarget(planWith({ quorum: 2 }))).toBeUndefined();
  });

  it('offers to change who has to be there when that is the rule, not a lower number', () => {
    const data = planWith({
      nearMisses: [
        missWith(['maya', 'priya', 'jess'], {
          kind: 'required_missing',
          userId: 'alex' as never,
        }),
      ],
    });
    expect(unlocksOf(data).map((u) => u.kind)).toEqual(['required', 'wider', 'close']);
    expect(blockedBy(data)).toBe(
      "Alex has to be there and can't make any of these. Here's the closest it got.",
    );
  });

  it('names a required member who has left the circle, because the engine still does', () => {
    const data = planWith({
      roster: [
        ...fixture.noQuorum.roster.slice(0, 5),
        { userId: 'alex', name: 'Alex', active: false },
      ],
      nearMisses: [missWith(['maya'], { kind: 'required_missing', userId: 'alex' as never })],
    });
    expect(blockedBy(data)).toContain('Alex');
  });

  it('runs the window out to the thirty days the domain allows, keeping its first day', () => {
    // The fixture asks about seven days from 14 September.
    expect(widerWindow(fixture.noQuorum)).toEqual({ start: '2026-09-14', end: '2026-10-13' });
    const wider = unlocksOf(fixture.noQuorum).find((u) => u.kind === 'wider');
    expect(wider?.title).toBe('Try a wider window');
    expect(wider?.body).toBe('Ask about 30 days instead of 7');
  });

  it('offers no wider window to a plan already asking about thirty days', () => {
    const data = planWith({ windowStart: '2026-09-14', windowEnd: '2026-10-13' });
    expect(widerWindow(data)).toBeUndefined();
    expect(unlocksOf(data).map((u) => u.kind)).toEqual(['lower', 'close']);
  });

  it('offers one more day in place of a wider window once replies have closed', () => {
    // `revise_plan` refuses any re-ask whose deadline has gone
    // (`deadline_out_of_range`); saying when replies close again is S2-05's
    // "give it one more day", which is what unblocks widening a stalled plan.
    const data = planWith({ repliesOpen: false });
    const justClosed = fromISO(data.responseDeadline);
    expect(unlocksOf(data, justClosed).map((u) => u.kind)).toEqual(['lower', 'extend', 'close']);
    const extend = unlocksOf(data, justClosed).find((u) => u.kind === 'extend');
    expect(extend?.title).toBe('Give it one more day');
    expect(extend?.body).toMatch(/^Reopens replies until /);
  });

  it('offers neither once the extra day is spent or there is no time left for one', () => {
    const spent = planWith({ repliesOpen: false, extendedThisRevision: true });
    expect(unlocksOf(spent, fromISO(spent.responseDeadline)).map((u) => u.kind)).toEqual([
      'lower',
      'close',
    ]);
    const late = planWith({ repliesOpen: false });
    expect(unlocksOf(late, fromISO(late.latestStart)).map((u) => u.kind)).toEqual([
      'lower',
      'close',
    ]);
  });

  it('says the quorum rule when that is the one blocking it', () => {
    expect(blockedBy(fixture.noQuorum)).toBe(
      "Nothing in the window works for at least 4 of you. Here's the closest it got.",
    );
  });
});
