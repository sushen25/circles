import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  QUIET_SENSITIVE_KINDS,
  notificationSpec,
} from './kinds.js';

/** The Pushes artboard's rows, in its order, plus the one email-only kind. */
const ARTBOARD: readonly NotificationKind[] = [
  'new_plan',
  'quiet_ask',
  'threshold_initiator',
  'threshold_keen',
  'deadline_approaching',
  'options_ready',
  'locked_in',
  'changed',
  'cancelled',
  'reminder',
  'did_it_happen',
  'about_time',
];

describe('the kind table', () => {
  it('is exactly the artboard, and nothing else', () => {
    // A kind not on an artboard is a message nobody designed. "Nothing about
    // activity, streaks or news, ever" is kept by the list being closed.
    expect(NOTIFICATION_KINDS.map((s) => s.kind)).toEqual([...ARTBOARD, 'verify_email']);
  });

  it('has one row per kind, no duplicates', () => {
    const kinds = NOTIFICATION_KINDS.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const kind of kinds) expect(notificationSpec(kind).kind).toBe(kind);
  });

  it('gives every kind at least one channel and a copy key', () => {
    for (const spec of NOTIFICATION_KINDS) {
      expect(spec.channels.length).toBeGreaterThan(0);
      expect(spec.copyKey).not.toBe('');
      // No sentence here: a copy key, not the text (non-negotiable 6).
      expect(spec.copyKey).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('exempts exactly confirmed, cancelled and the verification from quiet hours', () => {
    // Spec §5.8: "quiet hours 9 pm–8 am local except confirmed and cancelled".
    // `verify_email` is the third because somebody is waiting at the screen for
    // it and the link expires.
    const exempt = NOTIFICATION_KINDS.filter((s) => !s.respectsQuietHours).map((s) => s.kind);
    expect(exempt).toEqual(['locked_in', 'cancelled', 'verify_email']);
  });

  it('holds "changed" until morning, unlike its neighbour on the artboard', () => {
    // The spec's exception names confirmed and cancelled. "We are asking for
    // new times" is not urgent at midnight.
    expect(notificationSpec('changed').respectsQuietHours).toBe(true);
  });

  it('gives the organiser kinds an email fallback and the member kinds none', () => {
    // Review C6: the organiser gets these by email until they install the app,
    // which is why Slice 1 needs no native build. A member without the app
    // reaches email through a verified per-plan subscription instead.
    for (const kind of ['options_ready', 'did_it_happen', 'about_time'] as const) {
      expect(notificationSpec(kind).channels).toContain('email');
    }
    for (const kind of ['new_plan', 'quiet_ask', 'deadline_approaching'] as const) {
      expect(notificationSpec(kind).channels).toEqual(['push']);
    }
  });

  it('prefers push when both are possible, so email is the fallback and not the default', () => {
    for (const spec of NOTIFICATION_KINDS) {
      if (spec.channels.length > 1) expect(spec.channels[0]).toBe('push');
    }
  });

  it('marks the quiet-sensitive kinds, and only those', () => {
    expect(QUIET_SENSITIVE_KINDS).toEqual(['quiet_ask', 'threshold_initiator', 'threshold_keen']);
  });

  it('fails loudly for a kind with no row rather than sending nothing', () => {
    expect(() => notificationSpec('not_a_kind' as NotificationKind)).toThrow(RangeError);
  });
});
