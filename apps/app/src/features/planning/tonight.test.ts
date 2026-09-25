import { fromISO, type Instant } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { firstPlanPreview } from './firstPlan';
import { defaultDraft, presetAvailable, resolveDraft, tonightNote, type PlanDraft } from './form';
import { closesAtWords, closesDetail, closesIn, tonightNoteWords } from './words';

/**
 * Tonight and this weekend, end to end through the setup's arithmetic (S2-06):
 * the window, the deadline and what the card says, for the creation times the
 * ticket names. Melbourne is UTC+10 in September 2026; Tuesday is the 15th,
 * Saturday the 19th, Monday the 14th.
 *
 * ADR 0010 changed one of the ticket's cases: 9:45 pm is not "disabled" by the
 * clock. Tonight is refused only when no start is left for a meetup that long,
 * so at 9:45 pm the circle's two hours are refused and one hour is not.
 */
const ZONE = 'Australia/Melbourne';
const at = (iso: string): Instant => fromISO(iso);
const TUESDAY_5PM = at('2026-09-15T07:00:00.000Z');
const TUESDAY_9_15PM = at('2026-09-15T11:15:00.000Z');
const TUESDAY_9_45PM = at('2026-09-15T11:45:00.000Z');
const TUESDAY_11_10PM = at('2026-09-15T13:10:00.000Z');
const SATURDAY_10AM = at('2026-09-19T00:00:00.000Z');
const MONDAY_10AM = at('2026-09-14T00:00:00.000Z');

const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  ...defaultDraft({ duration: 120 }),
  ...overrides,
});

function resolved(overrides: Partial<PlanDraft>, now: Instant) {
  const answer = resolveDraft(draft(overrides), now, ZONE);
  if (!answer.ok) throw new Error(answer.problem);
  return answer;
}

describe('tonight, by the hour it is made', () => {
  it('5 pm: 5 pm to 11:30 pm today, replies close in 60 minutes', () => {
    const plan = resolved({ preset: 'tonight' }, TUESDAY_5PM);
    expect(plan.window).toEqual({ start: '2026-09-15', end: '2026-09-15' });
    expect(plan.band).toEqual({ startMin: 17 * 60, endMin: 23 * 60 + 30 });
    expect(plan.deadline).toBe('2026-09-15T08:00:00.000Z');
    expect(closesIn(plan.deadline, TUESDAY_5PM)).toBe('Replies close in 60 minutes');
    expect(closesDetail(plan, { deadline: undefined }, ZONE)).toMatch(/you can pick sooner$/);
  });

  it('9:15 pm: one start left, so replies stay open until it, and the card says why', () => {
    const plan = resolved({ preset: 'tonight' }, TUESDAY_9_15PM);
    expect(plan.band).toEqual({ startMin: 21 * 60 + 30, endMin: 23 * 60 + 30 });
    // Half an hour before the 9:30 start has gone, so the deadline is the start (ADR 0010).
    expect(plan.deadline).toBe(plan.latestStart);
    expect(plan.deadline).toBe('2026-09-15T11:30:00.000Z');
    expect(closesIn(plan.deadline, TUESDAY_9_15PM)).toBe('Replies close in 15 minutes');
    expect(closesDetail(plan, { deadline: undefined }, ZONE)).toMatch(
      /the last time it could start, so replies stay open until then$/,
    );
    expect(closesAtWords(plan, ZONE)).toMatch(/the last time it could start/);
  });

  it('9:45 pm: two hours no longer fit, one still does, and the chip says which', () => {
    expect(presetAvailable('tonight', undefined, 120, TUESDAY_9_45PM, ZONE)).toBe(false);
    expect(resolveDraft(draft({ preset: 'tonight' }), TUESDAY_9_45PM, ZONE)).toEqual({
      ok: false,
      problem: 'too_late_for_tonight',
    });
    expect(tonightNote(undefined, 120, TUESDAY_9_45PM, ZONE)).toBe('shorter');
    expect(tonightNoteWords('shorter')).toBe(
      'Too late tonight for a catch-up that long. Try a shorter one, or this weekend.',
    );

    const hour = resolved({ preset: 'tonight', duration: 60 }, TUESDAY_9_45PM);
    // Last start 10:30 pm; the earlier of 10:45 and 10 pm.
    expect(hour.deadline).toBe('2026-09-15T12:00:00.000Z');
  });

  it('11:10 pm: nothing fits, and the chip says to try the weekend', () => {
    expect(tonightNote(undefined, 60, TUESDAY_11_10PM, ZONE)).toBe('too_late');
    expect(tonightNoteWords('too_late')).toBe('Too late for tonight. Try this weekend.');
  });

  it('is on offer, with nothing to say, while it fits', () => {
    expect(tonightNote(undefined, 120, TUESDAY_5PM, ZONE)).toBeUndefined();
  });
});

describe('this weekend, by the day it is made', () => {
  it('on a Saturday: today and tomorrow, not next week', () => {
    const plan = resolved({ preset: 'this_weekend' }, SATURDAY_10AM);
    expect(plan.window).toEqual({ start: '2026-09-19', end: '2026-09-20' });
    expect(plan.band).toEqual({ startMin: 9 * 60, endMin: 22 * 60 + 30 });
    expect(plan.deadline).toBe('2026-09-20T00:00:00.000Z');
  });

  it('on a Monday: the coming Saturday and Sunday, replies in a day', () => {
    const plan = resolved({ preset: 'this_weekend' }, MONDAY_10AM);
    expect(plan.window).toEqual({ start: '2026-09-19', end: '2026-09-20' });
    expect(plan.deadline).toBe('2026-09-15T00:00:00.000Z');
    expect(closesIn(plan.deadline, MONDAY_10AM)).toBe('Replies close in 24 hours');
  });

  it('tonight on a Saturday is still this evening, from the next half hour', () => {
    const plan = resolved({ preset: 'tonight' }, SATURDAY_10AM);
    expect(plan.window).toEqual({ start: '2026-09-19', end: '2026-09-19' });
    expect(plan.band.startMin).toBe(10 * 60);
    expect(plan.deadline).toBe('2026-09-19T01:00:00.000Z');
  });
});

describe('the first-run card offers them too', () => {
  const circle = {
    zone: ZONE,
    defaultDurationMinutes: 120,
    defaultQuorum: null,
    members: 3,
  };

  it('previews tonight as the setup would make it', () => {
    const preview = firstPlanPreview(circle, TUESDAY_5PM, 'tonight');
    expect(preview.available).toBe(true);
    expect(preview.band).toEqual({ startMin: 17 * 60, endMin: 23 * 60 + 30 });
    expect(preview.deadline).toBe('2026-09-15T08:00:00.000Z');
  });

  it('marks tonight unavailable once two hours no longer fit', () => {
    expect(firstPlanPreview(circle, TUESDAY_9_45PM, 'tonight').available).toBe(false);
    expect(firstPlanPreview(circle, TUESDAY_9_45PM, 'this_weekend').available).toBe(true);
  });
});
