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
  it('is the artboard plus the two the spec names elsewhere, and nothing else', () => {
    // A kind not written down somewhere is a message nobody designed. "Nothing
    // about activity, streaks or news, ever" is kept by the list being closed.
    // `replies_closed` is §5.7's "one reminder at the deadline" and one of
    // §5.8's four organiser email kinds; the Pushes artboard has no row for it.
    expect(NOTIFICATION_KINDS.map((s) => s.kind)).toEqual([
      ...ARTBOARD.slice(0, 6),
      'replies_closed',
      ...ARTBOARD.slice(6),
      'did_it_happen_participant',
      'verify_email',
    ]);
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

  it('gives the organiser kinds an unconditional email fallback', () => {
    // Review C6: the organiser gets these by email until they install the app,
    // which is why Slice 1 needs no native build.
    for (const kind of [
      'options_ready',
      'replies_closed',
      'did_it_happen',
      'about_time',
    ] as const) {
      const spec = notificationSpec(kind);
      expect(spec.channels).toContain('email');
      expect(spec.emailNeedsSubscription).toBe(false);
    }
  });

  it('makes every member kind wait for a verified subscription', () => {
    // Being in a circle is not consent to be emailed (§8.2). The rule is in the
    // table because as a comment it was not a rule: `channels: [push, email]`
    // had email picked off a members list.
    for (const spec of NOTIFICATION_KINDS) {
      if (spec.audience === 'organiser' || spec.audience === 'nudge_recipient') continue;
      if (spec.kind === 'verify_email') continue;
      expect(spec.emailNeedsSubscription).toBe(true);
    }
  });

  it('never pushes the participant half of "did it happen"', () => {
    // The Pushes artboard's row is the organiser's. A subscriber's copy is an
    // email, and a channel list of one is how that stays true.
    expect(notificationSpec('did_it_happen_participant').channels).toEqual(['email']);
  });

  it('never asks the verification email for the consent it is asking for', () => {
    expect(notificationSpec('verify_email').emailNeedsSubscription).toBe(false);
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
