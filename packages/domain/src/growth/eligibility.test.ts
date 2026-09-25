import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Instant, fromISO } from '../shared/instant.js';
import {
  APP_BACK_OFF_DAYS,
  NUDGE_MOMENTS,
  type NudgeMoment,
  type NudgeRecord,
  appBackOffUntil,
  isPlanBoundMoment,
  nudgeEligibility,
  nudgeGroupOf,
  spendsSessionBudget,
  startedCircleFromPrompt,
} from './eligibility.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => fromISO(iso);
const later = (from: Instant, days: number) => (from + days * DAY) as Instant;

const NOW = at('2026-09-18T09:00:00Z');
const THURSDAY = 'plan-thu-17';
const NEXT_MONTH = 'plan-oct-15';

function row(moment: NudgeMoment, overrides: Partial<NudgeRecord> = {}): NudgeRecord {
  return {
    moment,
    planId: isPlanBoundMoment(moment) ? THURSDAY : null,
    shownAt: later(NOW, -1),
    answer: null,
    answeredAt: null,
    ...overrides,
  };
}

function dismissed(moment: NudgeMoment, when: Instant, planId = THURSDAY): NudgeRecord {
  return row(moment, { planId, shownAt: when, answer: 'dismissed', answeredAt: when });
}

const APP: readonly NudgeMoment[] = NUDGE_MOMENTS.filter((m) => nudgeGroupOf(m) === 'app');

describe('nudgeEligibility: who is asked', () => {
  it('never shows an app prompt to somebody using the app', () => {
    for (const moment of APP) {
      expect(nudgeEligibility(moment, [], 'app', NOW, { planId: THURSDAY })).toEqual({
        kind: 'skip',
        reason: 'installed',
      });
    }
  });

  it('asks only a guest to save a place, and meets only a guest with the gate', () => {
    for (const tier of ['saved', 'app'] as const) {
      expect(
        nudgeEligibility('reattached_save_place', [], tier, NOW, { planId: THURSDAY }),
      ).toEqual({ kind: 'skip', reason: 'already_saved' });
      expect(nudgeEligibility('organiser_gate', [], tier, NOW)).toEqual({
        kind: 'skip',
        reason: 'already_saved',
      });
    }
  });

  it('asks everybody who was there to start a circle, and offers everybody email', () => {
    for (const tier of ['guest', 'saved', 'app'] as const) {
      expect(
        nudgeEligibility('after_attendance_start_circle', [], tier, NOW, { planId: THURSDAY }),
      ).toEqual({ kind: 'show' });
      expect(nudgeEligibility('sent_save_access', [], tier, NOW, { planId: THURSDAY })).toEqual({
        kind: 'show',
      });
    }
  });

  it('refuses a plan-bound moment with no plan to bind it to', () => {
    expect(nudgeEligibility('sent_save_access', [], 'guest', NOW)).toEqual({
      kind: 'skip',
      reason: 'needs_plan',
    });
  });
});

describe('nudgeEligibility: once per moment per plan', () => {
  it('shows a moment once for a plan and again for the next plan', () => {
    const history = [row('sent_save_access')];
    expect(
      nudgeEligibility('sent_save_access', history, 'guest', NOW, { planId: THURSDAY }),
    ).toEqual({ kind: 'skip', reason: 'already_shown' });
    expect(
      nudgeEligibility('sent_save_access', history, 'guest', NOW, { planId: NEXT_MONTH }),
    ).toEqual({ kind: 'show' });
  });

  it('counts the email-then-app prompt and the locked-in nudge as one ask on a plan', () => {
    const history = [dismissed('email_given_app', later(NOW, -2))];
    expect(nudgeEligibility('locked_in_app', history, 'saved', NOW, { planId: THURSDAY })).toEqual({
      kind: 'skip',
      reason: 'already_shown',
    });
    expect(
      nudgeEligibility('locked_in_app', history, 'saved', NOW, { planId: NEXT_MONTH }),
    ).toEqual({ kind: 'show' });
  });

  it('says "save your place" after a reattach once, whichever plan the next one comes through', () => {
    const history = [row('reattached_save_place')];
    expect(
      nudgeEligibility('reattached_save_place', history, 'guest', NOW, { planId: NEXT_MONTH }),
    ).toEqual({ kind: 'skip', reason: 'already_shown' });
  });

  it('lets the gate through every time a guest reaches it', () => {
    const history = [dismissed('organiser_gate', later(NOW, -1), '')];
    expect(nudgeEligibility('organiser_gate', history, 'guest', NOW)).toEqual({ kind: 'show' });
    expect(
      nudgeEligibility('organiser_gate', history, 'guest', NOW, { shownThisSession: true }),
    ).toEqual({ kind: 'show' });
  });
});

describe('nudgeEligibility: one per session', () => {
  it('holds a second saved-place or app prompt in the same session', () => {
    for (const moment of ['after_attendance_start_circle', 'second_response_app'] as const) {
      expect(
        nudgeEligibility(moment, [], 'guest', NOW, { planId: THURSDAY, shownThisSession: true }),
      ).toEqual({ kind: 'skip', reason: 'session_cap' });
    }
  });

  it('never holds back the email card, which is not a conversion', () => {
    expect(
      nudgeEligibility('sent_save_access', [], 'guest', NOW, {
        planId: THURSDAY,
        shownThisSession: true,
      }),
    ).toEqual({ kind: 'show' });
    expect(spendsSessionBudget('sent_save_access')).toBe(false);
    expect(spendsSessionBudget('organiser_gate')).toBe(false);
    expect(spendsSessionBudget('reattached_save_place')).toBe(true);
  });
});

describe('nudgeEligibility: the moment itself', () => {
  it('asks to start a circle only after "I was there" on the circle\'s first meetup', () => {
    expect(
      nudgeEligibility('after_attendance_start_circle', [], 'guest', NOW, {
        planId: THURSDAY,
        attendedFirstInCircle: false,
      }),
    ).toEqual({ kind: 'skip', reason: 'not_the_moment' });
    expect(
      nudgeEligibility('after_attendance_start_circle', [], 'guest', NOW, {
        planId: THURSDAY,
        attendedFirstInCircle: true,
      }),
    ).toEqual({ kind: 'show' });
  });

  it('offers the app on a reattach only within 30 days of the first one', () => {
    const first = row('reattached_save_place', { shownAt: later(NOW, -10) });
    expect(
      nudgeEligibility('reattached_twice_app', [first], 'guest', NOW, { planId: THURSDAY }),
    ).toEqual({ kind: 'show' });
    expect(
      nudgeEligibility('reattached_twice_app', [], 'guest', NOW, { planId: THURSDAY }),
    ).toEqual({ kind: 'skip', reason: 'not_the_moment' });
    const old = row('reattached_save_place', { shownAt: later(NOW, -31) });
    expect(
      nudgeEligibility('reattached_twice_app', [old], 'guest', NOW, { planId: THURSDAY }),
    ).toEqual({ kind: 'skip', reason: 'not_the_moment' });
  });
});

describe('the 30-day back-off', () => {
  const first = later(NOW, -5);
  const second = later(NOW, -3);
  const twice = [
    dismissed('email_given_app', first, THURSDAY),
    dismissed('second_response_app', second, NEXT_MONTH),
  ];

  it('holds every app prompt for 30 days after the second "not now"', () => {
    expect(appBackOffUntil(twice)).toBe(later(second, APP_BACK_OFF_DAYS));
    for (const moment of ['locked_in_app', 'second_response_app'] as const) {
      expect(nudgeEligibility(moment, twice, 'guest', NOW, { planId: 'plan-nov' })).toEqual({
        kind: 'skip',
        reason: 'backed_off',
      });
    }
  });

  it('holds nothing else: the saved-place prompts are not the app group', () => {
    expect(
      nudgeEligibility('after_attendance_start_circle', twice, 'guest', NOW, {
        planId: 'plan-nov',
      }),
    ).toEqual({ kind: 'show' });
  });

  it('lets the app prompts back on the thirty-first day', () => {
    const after = later(second, APP_BACK_OFF_DAYS);
    expect(
      nudgeEligibility('locked_in_app', twice, 'guest', after, { planId: 'plan-nov' }),
    ).toEqual({ kind: 'show' });
  });

  it('is not started by one "not now", nor by a tap', () => {
    expect(appBackOffUntil([dismissed('email_given_app', first)])).toBeUndefined();
    expect(
      appBackOffUntil([
        dismissed('email_given_app', first),
        row('locked_in_app', { planId: NEXT_MONTH, answer: 'tapped', answeredAt: second }),
      ]),
    ).toBeUndefined();
  });

  it('counts afresh after a back-off, so two taps a year apart are not a ban', () => {
    const long = [
      dismissed('email_given_app', at('2025-01-01T00:00:00Z'), 'a'),
      dismissed('email_given_app', at('2025-01-02T00:00:00Z'), 'b'),
      dismissed('email_given_app', at('2026-06-01T00:00:00Z'), 'c'),
    ];
    expect(appBackOffUntil(long)).toBe(later(at('2025-01-02T00:00:00Z'), APP_BACK_OFF_DAYS));
    expect(nudgeEligibility('locked_in_app', long, 'guest', NOW, { planId: 'd' })).toEqual({
      kind: 'show',
    });
  });

  it('never ends before the second dismissal it follows (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 2, maxLength: 12 }),
        (offsets) => {
          const history = offsets.map((d, i) =>
            dismissed('second_response_app', later(at('2025-01-01T00:00:00Z'), d), `p${i}`),
          );
          const until = appBackOffUntil(history);
          expect(until).toBeDefined();
          const latestDismissal = Math.max(...history.map((r) => r.answeredAt!));
          // The back-off always starts from a real dismissal and lasts 30 days.
          expect(history.some((r) => later(r.answeredAt!, APP_BACK_OFF_DAYS) === until)).toBe(true);
          expect(until!).toBeLessThanOrEqual(later(latestDismissal as Instant, APP_BACK_OFF_DAYS));
        },
      ),
    );
  });
});

describe('startedCircleFromPrompt', () => {
  const tappedAt = later(NOW, -29);
  const tapped = row('after_attendance_start_circle', { answer: 'tapped', answeredAt: tappedAt });
  const savedAfter = later(tappedAt, 0.01);

  it("credits a circle made within 30 days of a guest's tap", () => {
    expect(startedCircleFromPrompt([tapped], NOW, savedAfter)).toBe(true);
    expect(startedCircleFromPrompt([tapped], later(NOW, 2), savedAfter)).toBe(false);
  });

  it('credits nothing to somebody who had a saved place when they tapped', () => {
    expect(startedCircleFromPrompt([tapped], NOW, later(tappedAt, -1))).toBe(false);
    expect(startedCircleFromPrompt([tapped], NOW, undefined)).toBe(false);
  });

  it('credits nothing to a prompt turned down or left unanswered', () => {
    expect(
      startedCircleFromPrompt(
        [row('after_attendance_start_circle', { answer: 'dismissed', answeredAt: NOW })],
        NOW,
        savedAfter,
      ),
    ).toBe(false);
    expect(startedCircleFromPrompt([row('after_attendance_start_circle')], NOW, savedAfter)).toBe(
      false,
    );
  });
});
