import { fromISO } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { canStep, cellsPerDay, EVENINGS, stepBand } from './bands';
import { deadlineChoices, deadlineDays } from './deadlines';
import { defaultDraft, presetAvailable, quorumRange, resolveDraft, type PlanDraft } from './form';

/**
 * The plan setup's arithmetic (spec §5.3): each preset's documented deadline,
 * what tonight can and cannot be, and the bounds the sheets offer. Melbourne
 * is UTC+10 in September, so 00:00Z is 10 am there.
 */
const ZONE = 'Australia/Melbourne';
const TUESDAY_10AM = fromISO('2026-09-15T00:00:00.000Z');
const HOUR = 3_600_000;

const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  ...defaultDraft({ duration: 120 }),
  ...overrides,
});

function deadlineOf(overrides: Partial<PlanDraft>, now = TUESDAY_10AM): string {
  const resolved = resolveDraft(draft(overrides), now, ZONE);
  if (!resolved.ok) throw new Error(resolved.problem);
  return resolved.deadline;
}

describe('every preset gives the deadline spec §5.3 documents', () => {
  it('tonight: an hour from now, when that is the earlier', () => {
    // Last start 9:30 pm (a 2-hour meetup in a band to 11:30 pm): 9 pm is
    // later than 11 am, so the hour wins.
    expect(deadlineOf({ preset: 'tonight' })).toBe('2026-09-15T01:00:00.000Z');
  });

  it('tonight: half an hour before the last start, when that is the earlier', () => {
    // 9:45 pm, a one-hour catch-up: the last start is 10:30 pm, so 10 pm.
    const late = fromISO('2026-09-15T11:45:00.000Z');
    expect(deadlineOf({ preset: 'tonight', duration: 60 }, late)).toBe('2026-09-15T12:00:00.000Z');
  });

  it('tonight: the last possible start itself, when the margin would be in the past (ADR 0010)', () => {
    // 10:10 pm, one hour: starts from 10:30, last start 10:30, and 10 pm has gone.
    const later = fromISO('2026-09-15T12:10:00.000Z');
    expect(deadlineOf({ preset: 'tonight', duration: 60 }, later)).toBe('2026-09-15T12:30:00.000Z');
  });

  it('this weekend and next 7 days: 24 hours', () => {
    const tomorrow = new Date(TUESDAY_10AM + 24 * HOUR).toISOString();
    expect(deadlineOf({ preset: 'this_weekend' })).toBe(tomorrow);
    expect(deadlineOf({ preset: 'next_7_days' })).toBe(tomorrow);
  });

  it('next 14 days: 72 hours', () => {
    expect(deadlineOf({ preset: 'next_14_days' })).toBe(
      new Date(TUESDAY_10AM + 72 * HOUR).toISOString(),
    );
  });

  it('custom: 24 hours, never after the last possible start', () => {
    expect(
      deadlineOf({ preset: 'custom', custom: { start: '2026-09-20', end: '2026-09-21' } }),
    ).toBe(new Date(TUESDAY_10AM + 24 * HOUR).toISOString());
    // Today only, evenings, two hours: the last start is 8:30 pm tonight,
    // which is sooner than tomorrow morning.
    expect(
      deadlineOf({ preset: 'custom', custom: { start: '2026-09-15', end: '2026-09-15' } }),
    ).toBe('2026-09-15T10:30:00.000Z');
  });

  it('keeps a deadline the organiser chose, and refuses one past the last start', () => {
    expect(deadlineOf({ deadline: '2026-09-16T08:00:00.000Z' })).toBe('2026-09-16T08:00:00.000Z');
    const resolved = resolveDraft(
      draft({ preset: 'this_weekend', deadline: '2026-09-30T08:00:00.000Z' }),
      TUESDAY_10AM,
      ZONE,
    );
    expect(resolved).toEqual({ ok: false, problem: 'deadline_out_of_range' });
  });
});

describe('the window', () => {
  it('re-resolves on duration: tonight fits an hour at 10:50 pm and not two', () => {
    const late = fromISO('2026-09-15T12:50:00.000Z');
    expect(presetAvailable('tonight', undefined, 60, late, ZONE)).toBe(false);
    expect(
      presetAvailable('tonight', undefined, 60, fromISO('2026-09-15T12:20:00.000Z'), ZONE),
    ).toBe(true);
    expect(
      presetAvailable('tonight', undefined, 120, fromISO('2026-09-15T12:20:00.000Z'), ZONE),
    ).toBe(false);
    expect(resolveDraft(draft({ preset: 'tonight' }), late, ZONE)).toEqual({
      ok: false,
      problem: 'too_late_for_tonight',
    });
  });

  it('takes a chosen band over the preset suggestion', () => {
    const resolved = resolveDraft(
      draft({ preset: 'this_weekend', band: { startMin: 14 * 60, endMin: 18 * 60 } }),
      TUESDAY_10AM,
      ZONE,
    );
    expect(resolved.ok && resolved.band).toEqual({ startMin: 840, endMin: 1080 });
    expect(resolved.ok && resolved.window).toEqual({ start: '2026-09-19', end: '2026-09-20' });
  });

  it('says a band is too short for the meetup rather than refusing silently', () => {
    const resolved = resolveDraft(
      draft({ band: { startMin: 18 * 60, endMin: 19 * 60 }, duration: 120 }),
      TUESDAY_10AM,
      ZONE,
    );
    expect(resolved).toEqual({ ok: false, problem: 'band_shorter_than_meetup' });
  });
});

describe('the quorum stepper', () => {
  it('runs from two to the people there are, and never below two', () => {
    expect(quorumRange(6)).toEqual({ min: 2, max: 6 });
    expect(quorumRange(1)).toEqual({ min: 2, max: 2 });
  });
});

describe('the band control', () => {
  it('moves half an hour at a time and stops at either end rather than breaking', () => {
    expect(stepBand(EVENINGS, 'start', 1)).toEqual({ startMin: 1080, endMin: 1350 });
    expect(stepBand({ startMin: 0, endMin: 60 }, 'start', -1)).toEqual({ startMin: 0, endMin: 60 });
    expect(canStep({ startMin: 60, endMin: 90 }, 'start', 1)).toBe(false);
    expect(canStep({ startMin: 60, endMin: 1440 }, 'end', 1)).toBe(false);
  });

  it('says what a band costs in half hours a day', () => {
    expect(cellsPerDay(EVENINGS)).toBe(10);
    expect(cellsPerDay({ startMin: 540, endMin: 1350 })).toBe(27);
  });
});

describe('the replies-close sheet', () => {
  it('offers only what fits before the last possible start, and the last start itself', () => {
    const latest = '2026-09-16T10:30:00.000Z'; // Wednesday 8:30 pm
    expect(deadlineChoices(TUESDAY_10AM, latest).map((c) => c.choice)).toEqual([
      'hour',
      'day',
      'latest',
    ]);
    expect(deadlineDays(TUESDAY_10AM, latest, ZONE)).toEqual(['2026-09-15', '2026-09-16']);
  });

  it('has no minimum: an hour away is on offer when the plan starts in two', () => {
    const latest = new Date(TUESDAY_10AM + 2 * HOUR).toISOString();
    expect(deadlineChoices(TUESDAY_10AM, latest).map((c) => c.choice)).toEqual(['hour', 'latest']);
  });
});
