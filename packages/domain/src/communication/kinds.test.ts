import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  QUIET_SENSITIVE_KINDS,
  notificationSpec,
  organiserEmailStopped,
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
  it('is the artboard plus the three the spec names elsewhere, and nothing else', () => {
    // A kind not written down somewhere is a message nobody designed. "Nothing
    // about activity, streaks or news, ever" is kept by the list being closed.
    // `replies_closed` is §5.7's "one reminder at the deadline" and one of
    // §5.8's four organiser email kinds; the Pushes artboard has no row for it.
    // `quiet_expired` is §5.4.7's closing notice, the SparkExpired artboard
    // (ADR 00XX).
    expect(NOTIFICATION_KINDS.map((s) => s.kind)).toEqual([
      ...ARTBOARD.slice(0, 6),
      'replies_closed',
      ...ARTBOARD.slice(6),
      'did_it_happen_participant',
      'verify_email',
      'quiet_expired',
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
      // The initiator's two letters go to their own address (ADR 00XX): about
      // their own ask, to them alone, like the organiser's.
      if (spec.audience === 'quiet_initiator') continue;
      expect(spec.emailNeedsSubscription).toBe(true);
    }
  });

  it('writes to the initiator at their own address, and to nobody else about a quiet ask', () => {
    // ADR 00XX. The two kinds whose audience is the initiator alone may be
    // emailed without a subscription; the two that reach other members stay
    // push-only, so no letter to anybody else ever concerns a quiet ask.
    for (const spec of NOTIFICATION_KINDS.filter((s) => s.audience === 'quiet_initiator')) {
      expect(spec.channels).toContain('email');
      expect(spec.emailNeedsSubscription).toBe(false);
      expect(spec.organiserEmailSwitch).toBe(false);
    }
    expect(notificationSpec('quiet_ask').channels).toEqual(['push']);
    expect(notificationSpec('threshold_keen').channels).toEqual(['push']);
    expect(notificationSpec('quiet_expired').channels).toEqual(['email']);
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

  it('lets the organiser-email switch stop exactly options ready and did it happen', () => {
    // ADR 0029. `replies_closed` still sends: the plan is waiting on the
    // organiser alone. `about_time` has its own switch, per circle.
    const stopped = NOTIFICATION_KINDS.filter((s) => s.organiserEmailSwitch).map((s) => s.kind);
    expect(stopped).toEqual(['options_ready', 'did_it_happen']);
    // A switch over a kind a subscription governs would be a second stop link
    // for consent that already has one, and one over a push-only kind would be
    // a switch that stops nothing.
    for (const kind of stopped) {
      expect(notificationSpec(kind).emailNeedsSubscription).toBe(false);
      expect(notificationSpec(kind).channels).toContain('email');
    }
  });

  it('stops a kind only when the switch is off and the kind is one it covers', () => {
    const table: readonly [NotificationKind, boolean, boolean][] = [
      ['options_ready', true, true],
      ['did_it_happen', true, true],
      ['options_ready', false, false],
      ['did_it_happen', false, false],
      ['replies_closed', true, false],
      ['about_time', true, false],
      ['locked_in', true, false],
      ['did_it_happen_participant', true, false],
      ['verify_email', true, false],
    ];
    for (const [kind, switchedOff, stopped] of table) {
      expect(organiserEmailStopped(kind, switchedOff), `${kind}, off=${switchedOff}`).toBe(stopped);
    }
  });

  it('marks the quiet-sensitive kinds, and only those', () => {
    expect(QUIET_SENSITIVE_KINDS).toEqual([
      'quiet_ask',
      'threshold_initiator',
      'threshold_keen',
      'quiet_expired',
    ]);
  });

  it('fails loudly for a kind with no row rather than sending nothing', () => {
    expect(() => notificationSpec('not_a_kind' as NotificationKind)).toThrow(RangeError);
  });
});
