import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FORBIDDEN_PAYLOAD_KEYS, catalogue, validateEvent } from './analytics';

const entries = Object.entries(catalogue);

describe('the analytics catalogue', () => {
  it('declares every event with a version and a payload schema', () => {
    expect(entries.length).toBeGreaterThan(40);
    for (const [name, entry] of entries) {
      expect(entry.version, name).toBeGreaterThanOrEqual(1);
      expect(entry.payload, name).toBeInstanceOf(z.ZodObject);
    }
  });

  it('covers every event the spec requires (§11.3)', () => {
    // Spot-checking a list this long is how one quietly goes missing.
    const required = [
      'account_started',
      'account_completed',
      'circle_created',
      'circle_invite_shared',
      'circle_join_opened',
      'circle_joined',
      'session_missing_on_return',
      'member_reattached',
      'duplicate_member_removed',
      'plan_created',
      'plan_shared',
      'plan_edited',
      'plan_expired',
      'plan_cancelled',
      'plan_rescheduled',
      'quiet_ask_created',
      'quiet_interest_answered',
      'quiet_threshold_reached',
      'organiser_accepted',
      'availability_started',
      'availability_submitted',
      'candidate_set_generated',
      'candidate_viewed',
      'candidate_selected',
      'deadline_passed_action',
      'meetup_confirmed',
      'organiser_chased',
      'share_opened',
      'calendar_add_opened',
      'ics_downloaded',
      'email_updates_offered',
      'email_submitted',
      'email_verified',
      'email_subscription_changed',
      'email_delivery_result',
      'outcome_reported',
      'attendance_confirmed',
      'cadence_prompt_sent',
      'plan_another_started',
      'app_nudge_shown',
      'app_nudge_dismissed',
      'app_nudge_tapped',
      'account_claimed',
      'app_first_open_linked',
      'guest_started_circle',
      'calendar_explanation_viewed',
      'calendar_permission_result',
      'calendar_overlay_used',
      'push_permission_result',
    ];
    expect(Object.keys(catalogue).sort()).toEqual(expect.arrayContaining(required.sort()));
  });
});

describe('no payload can carry a person', () => {
  it('declares no key that could hold someone’s words', () => {
    for (const [name, entry] of entries) {
      for (const key of Object.keys(entry.payload.shape)) {
        for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
          expect(key, `${name}.${key}`).not.toContain(forbidden);
        }
      }
    }
  });

  it('rejects a payload carrying a name, email, note, token or title', () => {
    for (const [name, entry] of entries) {
      for (const forbidden of ['name', 'email', 'note', 'token', 'title']) {
        const result = entry.payload.safeParse({ [forbidden]: 'Maya' });
        expect(result.success, `${name} accepted a "${forbidden}" key`).toBe(false);
      }
    }
  });

  it('accepts only identifiers, enums, numbers and booleans', () => {
    const allowed = new Set([
      'ZodString',
      'ZodNumber',
      'ZodBoolean',
      'ZodEnum',
      'ZodOptional',
      'ZodInt',
    ]);
    for (const [name, entry] of entries) {
      for (const [key, schema] of Object.entries(entry.payload.shape)) {
        const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
        const kind = inner.constructor.name;
        expect(allowed.has(kind) || kind.startsWith('Zod'), `${name}.${key} is ${kind}`).toBe(true);
      }
    }
  });
});

describe('validateEvent', () => {
  it('stamps the catalogue version so a query can tell shapes apart', () => {
    const tracked = validateEvent('availability_submitted', { status: 'flexible' });
    expect(tracked).toEqual({
      name: 'availability_submitted',
      version: 1,
      properties: { status: 'flexible' },
    });
  });

  it('returns null rather than throwing, so tracking never breaks a screen', () => {
    expect(validateEvent('availability_submitted', { status: 'nonsense' })).toBeNull();
    // The value is irrelevant — it is the *key* that must never be accepted.
    expect(validateEvent('circle_created', { email: 'redacted' })).toBeNull();
  });
});
