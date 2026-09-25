import { describe, expect, it } from 'vitest';

import { circleId } from '../circles/types.js';
import { confirmationId } from '../confirmation/types.js';
import { localDate } from '../shared/local-date.js';
import { NOTIFICATION_KINDS, type NotificationKind } from './kinds.js';
import { fromISO, toISO } from '../shared/instant.js';
import { zone } from '../shared/zone.js';
import {
  FOLLOW_UP,
  ONCE,
  deadlineReminderAt,
  deadlineReminderDue,
  occurrenceFor,
} from './occurrence.js';

const A_CONFIRMATION = confirmationId('confirmation-1');
const A_DUE_DATE = localDate('2026-10-08');

describe('occurrenceFor', () => {
  it('says "once" for the kinds that happen once per plan revision', () => {
    for (const kind of [
      'new_plan',
      'quiet_ask',
      'threshold_initiator',
      'threshold_keen',
      'deadline_approaching',
      'options_ready',
      'cancelled',
    ] as const) {
      expect(occurrenceFor(kind)).toBe(ONCE);
    }
  });

  it('gives each deadline its own replies-closed letter, and one follow-up each', () => {
    // "Give it one more day" is an `adjust`: the revision stays put, so an
    // occurrence of `ONCE` made the extended deadline's closure a duplicate of
    // the first and nobody was told (SUS-36 review round 5).
    const first = fromISO('2026-09-15T08:00:00.000Z');
    const extended = fromISO('2026-09-16T08:00:00.000Z');
    const closed = occurrenceFor('replies_closed', { deadline: first });
    const again = occurrenceFor('replies_closed', { deadline: extended });
    const followUp = occurrenceFor('replies_closed', { deadline: first, followUp: true });
    expect(new Set([closed, again, followUp, ONCE]).size).toBe(4);
    expect(followUp.endsWith(FOLLOW_UP)).toBe(true);
    // Stable: the same deadline is the same letter, so a retry is swallowed.
    expect(occurrenceFor('replies_closed', { deadline: first })).toBe(closed);
    expect(() => occurrenceFor('replies_closed')).toThrow(RangeError);
  });

  it('gives each material change its own occurrence, not one per revision', () => {
    // A reschedule bumps the revision; a place correction on a live
    // confirmation does not. Sharing an occurrence means the unique index drops
    // the second message and nobody is told the venue moved.
    expect(occurrenceFor('changed', { changeId: 'event-1' })).toBe('event-1');
    expect(occurrenceFor('changed', { changeId: 'event-2' })).not.toBe('event-1');
    expect(() => occurrenceFor('changed')).toThrow(RangeError);
  });

  it('ties the confirmation kinds to the confirmation', () => {
    for (const kind of [
      'locked_in',
      'reminder',
      'did_it_happen',
      'did_it_happen_participant',
    ] as const) {
      expect(occurrenceFor(kind, { confirmationId: A_CONFIRMATION })).toBe(A_CONFIRMATION);
    }
  });

  it('makes a reconfirmation a different message, not a swallowed duplicate', () => {
    const first = occurrenceFor('reminder', { confirmationId: A_CONFIRMATION });
    const second = occurrenceFor('reminder', { confirmationId: confirmationId('confirmation-2') });
    expect(first).not.toBe(second);
  });

  it('makes each month a different nudge, and each circle a different one again', () => {
    // `about_time` recurs for the life of the circle with no plan to hang from,
    // so the due date separates September's nudge from October's — and the
    // circle separates two circles that fall due on the same day, which the
    // idempotency key cannot, because it carries no plan for these sends.
    const sunday = occurrenceFor('about_time', {
      circleId: circleId('circle-1'),
      dueDate: A_DUE_DATE,
    });
    const bookClub = occurrenceFor('about_time', {
      circleId: circleId('circle-2'),
      dueDate: A_DUE_DATE,
    });
    const november = occurrenceFor('about_time', {
      circleId: circleId('circle-1'),
      dueDate: localDate('2026-11-08'),
    });
    expect(new Set([sunday, bookClub, november]).size).toBe(3);
  });

  it('cannot have a circle id shift the boundary into the date', () => {
    // Length-prefixed, so ("ab", "c") and ("a", "bc") stay different.
    const left = occurrenceFor('about_time', { circleId: circleId('ab'), dueDate: 'c' as never });
    const right = occurrenceFor('about_time', { circleId: circleId('a'), dueDate: 'bc' as never });
    expect(left).not.toBe(right);
  });

  it('makes a resent verification a new email', () => {
    // "Resend invalidates the previous token" (spec §5.8): the second email is
    // not a duplicate of the first, it is the only one that still works.
    expect(occurrenceFor('verify_email', { verificationId: 'v1' })).toBe('v1');
    expect(occurrenceFor('verify_email', { verificationId: 'v2' })).not.toBe('v1');
  });

  it('refuses rather than inventing one when the caller left the id out', () => {
    for (const kind of ['locked_in', 'reminder', 'did_it_happen'] as const) {
      expect(() => occurrenceFor(kind)).toThrow(RangeError);
    }
    expect(() => occurrenceFor('about_time')).toThrow(RangeError);
    expect(() => occurrenceFor('about_time', { dueDate: A_DUE_DATE })).toThrow(RangeError);
    expect(() => occurrenceFor('about_time', { circleId: circleId('circle-1') })).toThrow(
      RangeError,
    );
    expect(() => occurrenceFor('verify_email')).toThrow(RangeError);
    // An empty string is the same mistake wearing a value.
    expect(() =>
      occurrenceFor('about_time', { circleId: circleId('circle-1'), dueDate: '' as never }),
    ).toThrow(RangeError);
  });

  it('answers for every kind in the table', () => {
    const input = {
      confirmationId: A_CONFIRMATION,
      dueDate: A_DUE_DATE,
      verificationId: 'v1',
      changeId: 'event-1',
      circleId: circleId('circle-1'),
      deadline: fromISO('2026-09-15T08:00:00.000Z'),
    };
    for (const spec of NOTIFICATION_KINDS) {
      expect(occurrenceFor(spec.kind as NotificationKind, input).length).toBeGreaterThan(0);
    }
  });
});

describe('when the deadline reminder is due', () => {
  const MELBOURNE = zone('Australia/Melbourne');
  const thursday = localDate('2026-09-17');

  it('is 24 hours before, for a plan of more than one day', () => {
    const plan = {
      window: { start: thursday, end: localDate('2026-09-30') },
      zone: MELBOURNE,
      responseDeadline: fromISO('2026-09-20T08:00:00.000Z'),
    };
    expect(toISO(deadlineReminderAt(plan))).toBe('2026-09-19T08:00:00.000Z');
  });

  it('is 20 minutes before, for tonight', () => {
    // Made at 5 pm Thursday, replies close at 6 pm: a day ahead is before the plan existed.
    const plan = {
      window: { start: thursday, end: thursday },
      zone: MELBOURNE,
      responseDeadline: fromISO('2026-09-17T08:00:00.000Z'),
    };
    expect(toISO(deadlineReminderAt(plan))).toBe('2026-09-17T07:40:00.000Z');
    expect(deadlineReminderDue(plan, fromISO('2026-09-17T07:30:00.000Z'))).toBe(false);
    expect(deadlineReminderDue(plan, fromISO('2026-09-17T07:40:00.000Z'))).toBe(true);
    expect(deadlineReminderDue(plan, fromISO('2026-09-17T08:00:00.000Z'))).toBe(false);
  });

  it('keeps a day ahead for a one-day plan whose replies close the day before', () => {
    const saturday = localDate('2026-09-19');
    const plan = {
      window: { start: saturday, end: saturday },
      zone: MELBOURNE,
      responseDeadline: fromISO('2026-09-18T08:00:00.000Z'),
    };
    expect(toISO(deadlineReminderAt(plan))).toBe('2026-09-17T08:00:00.000Z');
  });
});
