import { describe, expect, it } from 'vitest';

import { type Instant, fromISO } from '../shared/instant.js';
import { toISO } from '../shared/instant.js';
import { zone } from '../shared/zone.js';
import { cadenceState, nextDueAt, nudgeLeadDays } from './cadence.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { LAST_MET, circle } from './fixtures.js';

describe('nudgeLeadDays', () => {
  it('warns a week ahead on the long cadences and two days on the short ones', () => {
    expect(nudgeLeadDays('monthly')).toBe(7);
    expect(nudgeLeadDays('two_monthly')).toBe(7);
    expect(nudgeLeadDays('weekly')).toBe(2);
    expect(nudgeLeadDays('fortnightly')).toBe(2);
  });

  it('never warns about a circle with no goal', () => {
    expect(nudgeLeadDays('none')).toBe(0);
  });
});

describe('nextDueAt', () => {
  // 8 August 2026 18:30 Melbourne.
  it.each([
    ['weekly', '2026-08-15T08:30:00.000Z'],
    ['fortnightly', '2026-08-22T08:30:00.000Z'],
    ['monthly', '2026-09-08T08:30:00.000Z'],
    ['two_monthly', '2026-10-08T07:30:00.000Z'],
  ] as const)('%s', (cadence, expected) => {
    expect(toISO(nextDueAt(LAST_MET, cadence, MELBOURNE) as Instant)).toBe(expected);
  });

  it('is never due when there is no goal', () => {
    expect(nextDueAt(LAST_MET, 'none', MELBOURNE)).toBeUndefined();
  });

  it('holds the local hour across a DST change rather than drifting an hour', () => {
    // Melbourne moves to daylight time on the first Sunday in October 2026.
    // Two months from 8 August lands the far side of it. Adding 61 days of
    // milliseconds would give 08:30 local; the local hour is what people keep.
    const due = nextDueAt(LAST_MET, 'two_monthly', MELBOURNE) as Instant;
    expect(toISO(due)).toBe('2026-10-08T07:30:00.000Z'); // still 18:30 Melbourne
  });

  it('clamps the day rather than sliding into the month after', () => {
    // 31 January + 1 month is the end of February, not 3 March.
    const utc = zone('UTC');
    const jan31 = fromISO('2026-01-31T12:00:00Z');
    expect(toISO(nextDueAt(jan31, 'monthly', utc) as Instant)).toBe('2026-02-28T12:00:00.000Z');
  });

  it('crosses a year boundary', () => {
    const utc = zone('UTC');
    const dec = fromISO('2026-12-15T12:00:00Z');
    expect(toISO(nextDueAt(dec, 'monthly', utc) as Instant)).toBe('2027-01-15T12:00:00.000Z');
  });
});

describe('cadenceState', () => {
  const monthly = circle({ cadence: 'monthly' });
  // Due 8 September; the lead is 7 days, so the prompt appears on 1 September.
  const due = nextDueAt(LAST_MET, 'monthly', MELBOURNE) as Instant;
  const showFrom = fromISO('2026-09-01T08:30:00.000Z');

  it('lets an active plan win over any cadence prompt', () => {
    expect(cadenceState(monthly, due, true)).toBe('active_plan');
  });

  it('says nothing to a circle that set no goal', () => {
    expect(cadenceState(circle({ cadence: 'none' }), due)).toBe('no_goal');
  });

  it('distinguishes a circle that has never met from one that is simply not due', () => {
    const fresh = circle({ lastMetAt: undefined });
    expect(cadenceState(fresh, due)).toBe('never_met');
  });

  it('transitions at exactly the lead days, not before', () => {
    expect(cadenceState(monthly, (showFrom - 1) as Instant)).toBe('no_rush');
    expect(cadenceState(monthly, showFrom)).toBe('due_soon');
  });

  it('stays due after the date passes — it never becomes "overdue"', () => {
    expect(cadenceState(monthly, (due + 30 * 86_400_000) as Instant)).toBe('due_soon');
  });

  it('suppresses the prompt while snoozed, without moving the due date', () => {
    const snoozed = circle({
      cadence: 'monthly',
      cadenceSnoozedUntil: fromISO('2026-10-01T00:00:00Z'),
    });
    expect(cadenceState(snoozed, due)).toBe('no_rush');
    // The rhythm is not pushed back: once the snooze lapses it is due again.
    expect(cadenceState(snoozed, fromISO('2026-10-02T00:00:00Z'))).toBe('due_soon');
  });
});
