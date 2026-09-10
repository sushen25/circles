import { describe, expect, it } from 'vitest';

import { confirmationId } from '../confirmation/types.js';
import { localDate } from '../shared/local-date.js';
import { NOTIFICATION_KINDS, type NotificationKind } from './kinds.js';
import { ONCE, occurrenceFor } from './occurrence.js';

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
      'changed',
      'cancelled',
    ] as const) {
      expect(occurrenceFor(kind)).toBe(ONCE);
    }
  });

  it('ties the confirmation kinds to the confirmation', () => {
    for (const kind of ['locked_in', 'reminder', 'did_it_happen'] as const) {
      expect(occurrenceFor(kind, { confirmationId: A_CONFIRMATION })).toBe(A_CONFIRMATION);
    }
  });

  it('makes a reconfirmation a different message, not a swallowed duplicate', () => {
    const first = occurrenceFor('reminder', { confirmationId: A_CONFIRMATION });
    const second = occurrenceFor('reminder', { confirmationId: confirmationId('confirmation-2') });
    expect(first).not.toBe(second);
  });

  it('makes each month a different nudge', () => {
    // `about_time` recurs for the life of the circle with no plan to hang from,
    // so the due date is what separates September's nudge from October's.
    expect(occurrenceFor('about_time', { dueDate: A_DUE_DATE })).toBe(A_DUE_DATE);
    expect(occurrenceFor('about_time', { dueDate: localDate('2026-11-08') })).not.toBe(A_DUE_DATE);
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
    expect(() => occurrenceFor('verify_email')).toThrow(RangeError);
    // An empty string is the same mistake wearing a value.
    expect(() => occurrenceFor('about_time', { dueDate: '' as never })).toThrow(RangeError);
  });

  it('answers for every kind in the table', () => {
    const input = {
      confirmationId: A_CONFIRMATION,
      dueDate: A_DUE_DATE,
      verificationId: 'v1',
    };
    for (const spec of NOTIFICATION_KINDS) {
      expect(occurrenceFor(spec.kind as NotificationKind, input).length).toBeGreaterThan(0);
    }
  });
});
