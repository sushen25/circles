import { describe, expect, it } from 'vitest';

import { circle } from '../circles/fixtures.js';
import { LAST_MET } from '../circles/fixtures.js';
import type { Actor } from '../planning/state-machine.js';
import { planId } from '../planning/types.js';
import { ALEX, PRIYA, SAM, SUNDAY_CREW } from '../scheduling/fixtures.js';
import { fromISO, toISO } from '../shared/instant.js';
import { A_STRANGER, confirmation, sundayCrewPlan } from './fixtures.js';
import { corroboration, lastMetAtAfter, reportOutcome, statusAfter } from './outcome.js';
import type { Attendance, Outcome, OutcomeReport } from './types.js';
import { NOTE_MAX_LENGTH } from './types.js';

const OUTCOMES: readonly Outcome[] = ['happened', 'cancelled', 'moved_outside', 'not_sure'];

const ORGANISER: Actor = {
  userId: SUNDAY_CREW[0] as string,
  isPermanent: true,
  isMember: true,
  isOrganiser: true,
  isOwner: true,
};

const CONFIRMED_PLAN = sundayCrewPlan({ state: 'confirmed' });
const MORNING_AFTER = fromISO('2026-09-17T22:00:00Z');

function report(overrides: Partial<Parameters<typeof reportOutcome>[0]> = {}) {
  return reportOutcome({
    plan: CONFIRMED_PLAN,
    confirmation: confirmation({ planId: CONFIRMED_PLAN.id }),
    outcome: 'happened',
    actor: ORGANISER,
    now: MORNING_AFTER,
    ...overrides,
  });
}

describe('reportOutcome', () => {
  it('records who said what, when, and completes the plan', () => {
    const result = report({ note: 'Great night, Hope St again next time' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.report.outcome).toBe('happened');
    expect(result.value.report.reportedBy).toBe(SUNDAY_CREW[0]);
    expect(result.value.report.reportedAt).toBe(MORNING_AFTER);
    expect(result.value.report.circleId).toBe(CONFIRMED_PLAN.circleId);
    expect(result.value.plan.state).toBe('completed');
  });

  it('leaves the confirmed time and the people alone', () => {
    const before = confirmation({ planId: CONFIRMED_PLAN.id });
    const result = report({ confirmation: before });
    expect(result.ok && result.value.confirmation.candidate).toEqual(before.candidate);
  });

  it('closes the confirmation as completed, or cancelled when it did not happen', () => {
    expect(statusAfter('happened')).toBe('completed');
    expect(statusAfter('moved_outside')).toBe('completed');
    expect(statusAfter('not_sure')).toBe('completed');
    expect(statusAfter('cancelled')).toBe('cancelled');
    const result = report({ outcome: 'cancelled' });
    expect(result.ok && result.value.confirmation.status).toBe('cancelled');
  });

  it('refuses anyone who is not the organiser', () => {
    const result = report({ actor: { ...ORGANISER, userId: A_STRANGER, isOrganiser: false } });
    expect(!result.ok && result.error.code).toBe('not_the_organiser');
  });

  it('refuses a confirmation that was already superseded', () => {
    // Otherwise `happened` on a rescheduled Thursday would move `lastMetAt` to
    // an evening the circle explicitly abandoned.
    const result = report({
      confirmation: confirmation({ planId: CONFIRMED_PLAN.id, status: 'superseded' }),
    });
    expect(!result.ok && result.error.code).toBe('confirmation_not_active');
  });

  it('refuses a confirmation that belongs to another plan', () => {
    const result = report({ confirmation: confirmation({ planId: planId('plan-elsewhere') }) });
    expect(!result.ok && result.error.code).toBe('wrong_plan');
  });

  it('refuses a record note over the same 280 as the confirmation note', () => {
    expect(!report({ note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).ok).toBe(true);
    expect(report({ note: 'x'.repeat(NOTE_MAX_LENGTH) }).ok).toBe(true);
  });

  it('refuses a plan that was never confirmed', () => {
    const result = report({ plan: sundayCrewPlan({ state: 'ready' }) });
    expect(!result.ok && result.error.code).toBe('wrong_state');
  });
});

describe('lastMetAtAfter', () => {
  const met = circle();
  const confirmed = confirmation();

  it('moves to the time the circle met, not to when it was reported', () => {
    const after = lastMetAtAfter(met, confirmed, 'happened');
    expect(after).toBe(confirmed.candidate.start);
    expect(toISO(after as number & { __brand: 'Instant' })).toBe('2026-09-17T08:30:00.000Z');
  });

  it('is unchanged for cancelled, moved outside and not sure', () => {
    for (const outcome of OUTCOMES.filter((o) => o !== 'happened')) {
      expect(lastMetAtAfter(met, confirmed, outcome)).toBe(LAST_MET);
    }
  });

  it('sets it for a circle that has never met', () => {
    const fresh = circle({ lastMetAt: undefined });
    expect(lastMetAtAfter(fresh, confirmed, 'happened')).toBe(confirmed.candidate.start);
    expect(lastMetAtAfter(fresh, confirmed, 'not_sure')).toBeUndefined();
  });

  it('never moves backwards when an old outcome is reported late', () => {
    // The circle met again in October; somebody finally answers September's
    // email. Cadence reads this field, so a backwards step would make a circle
    // that met last week look overdue.
    const october = circle({ lastMetAt: fromISO('2026-10-10T08:30:00Z') });
    expect(lastMetAtAfter(october, confirmed, 'happened')).toBe(october.lastMetAt);
  });
});

describe('corroboration', () => {
  const base: OutcomeReport = {
    confirmationId: confirmation().id,
    circleId: CONFIRMED_PLAN.circleId,
    outcome: 'happened',
    reportedBy: SAM,
    reportedAt: MORNING_AFTER,
  };
  const wasThere = (userId: typeof SAM): Attendance => ({
    confirmationId: base.confirmationId,
    userId,
    status: 'was_there',
    updatedAt: MORNING_AFTER,
  });

  it('needs somebody other than the reporter', () => {
    expect(corroboration(base, [wasThere(SAM)])).toBe('reported');
    expect(corroboration(base, [wasThere(SAM), wasThere(PRIYA)])).toBe('corroborated');
  });

  it('is "reported" when nobody has said anything', () => {
    expect(corroboration(base, [])).toBe('reported');
  });

  it('does not count someone who says they missed it', () => {
    const missed: Attendance = { ...wasThere(ALEX), status: 'missed' };
    expect(corroboration(base, [missed])).toBe('reported');
  });

  it('is never corroborated for an outcome other than happened', () => {
    for (const outcome of OUTCOMES.filter((o) => o !== 'happened')) {
      expect(corroboration({ ...base, outcome }, [wasThere(PRIYA)])).toBe('reported');
    }
  });
});
