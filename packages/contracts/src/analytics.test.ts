import { NUDGE_MOMENTS as DOMAIN_MOMENTS } from '@circles/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CLAIM_MOMENTS,
  FORBIDDEN_PAYLOAD_KEYS,
  NUDGE_MOMENTS,
  UNATTRIBUTED_EVENTS,
  acceptEvent,
  catalogue,
  isUnattributed,
  validateEvent,
} from './analytics';

const entries = Object.entries(catalogue);
const PLAN_ID = '00000000-0000-4000-8000-0000000000a1';

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
      'organiser_email_changed',
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

  it('records every one of the five answers, more_notice included (spec §5.5)', () => {
    for (const status of ['windows', 'flexible', 'none_work', 'more_notice', 'not_this_time']) {
      expect(validateEvent('availability_submitted', { status }), status).not.toBeNull();
    }
  });

  it("records the first-run plan's fourteen days as its own window (S1-22)", () => {
    expect(
      validateEvent('plan_created', {
        mode: 'named',
        window: 'next_two_weeks',
        used_defaults: true,
      }),
    ).not.toBeNull();
  });

  it('returns null rather than throwing, so tracking never breaks a screen', () => {
    expect(validateEvent('availability_submitted', { status: 'nonsense' })).toBeNull();
    // The value is irrelevant — it is the *key* that must never be accepted.
    expect(validateEvent('circle_created', { email: 'redacted' })).toBeNull();
  });
});

describe('acceptEvent, which is what the ingest uses', () => {
  it('drops a key the catalogue does not declare rather than losing the event', () => {
    // Architecture §15: "unknown keys are dropped". A tab open since before a
    // deploy should still be counted for the release the count is about.
    expect(acceptEvent('availability_submitted', { status: 'flexible', added_later: 7 })).toEqual({
      name: 'availability_submitted',
      version: 1,
      properties: { status: 'flexible' },
    });
  });

  it('drops a forbidden key instead of carrying it into the table', () => {
    const accepted = acceptEvent('circle_created', { email: 'someone@example.com' });

    expect(accepted).toEqual({ name: 'circle_created', version: 1, properties: {} });
    expect(JSON.stringify(accepted)).not.toContain('@');
  });

  it('still refuses an event whose declared fields are wrong', () => {
    // Dropping happens before validation, not instead of it.
    expect(acceptEvent('availability_submitted', { status: 'nonsense' })).toBeNull();
    expect(acceptEvent('availability_submitted', {})).toBeNull();
  });

  it('refuses a name the catalogue does not declare', () => {
    expect(acceptEvent('made_up_event', {})).toBeNull();
    expect(acceptEvent('constructor', {})).toBeNull();
  });
});

describe('the nudge moments', () => {
  it("are the domain's, whose rules are over them", () => {
    // `nudge_states.moment` (0028) is checked against exactly this list, and
    // `150_analytics.sql` asserts the constraint matches. A moment added here
    // and not to the constraint is a write that fails in production with a
    // check violation; this is the half of that guard that lives here.
    expect([...NUDGE_MOMENTS]).toEqual([...DOMAIN_MOMENTS].sort());
  });

  it('are measured apart from the moments a place is saved at', () => {
    // A prompt is not a claim: "save your place" after a reattach is shown at
    // `reattached_save_place` and claimed at `reattached`, so the conversion
    // map can divide one by the other without the two being the same list.
    expect(catalogue.account_claimed.payload.shape.moment.options).toEqual([...CLAIM_MOMENTS]);
  });
});

describe('the confirmation events (S1-28)', () => {
  it('records the chasing survey as the three answers the review screen offers', () => {
    for (const answer of ['none', 'one', 'more']) {
      expect(validateEvent('organiser_chased', { answer })?.version).toBe(2);
    }
    // Version 1's `yes | no` could not tell one chased person from several.
    expect(validateEvent('organiser_chased', { answer: 'yes' })).toBeNull();
  });

  it('records which way an attendance correction went, and only the two before-the-meetup ones', () => {
    expect(validateEvent('attendance_updated', { status: 'going' })).not.toBeNull();
    expect(validateEvent('attendance_updated', { status: 'cant' })).not.toBeNull();
    // "I was there" is `attendance_confirmed`, the morning after's question.
    expect(validateEvent('attendance_updated', { status: 'was_there' })).toBeNull();
  });
});

describe('the quiet ask events (SUS-51, spec §8.2)', () => {
  it('say nothing about who asked, what anybody answered or how the organiser came to it', () => {
    // Each would sit beside `user_id`: `answer` was an individual answer, and
    // `role: 'initiator'` was the initiator with their id on the row.
    // Nothing at all: not even a plan, which could be joined to who asked.
    expect(Object.keys(catalogue.quiet_interest_answered.payload.shape)).toEqual([]);
    expect(Object.keys(catalogue.quiet_ask_created.payload.shape)).toEqual([]);
    expect(validateEvent('quiet_ask_created', { plan_id: PLAN_ID })).toBeNull();
    expect(Object.keys(catalogue.organiser_accepted.payload.shape).sort()).toEqual([
      'circle_id',
      'plan_id',
    ]);
    expect(validateEvent('quiet_interest_answered', { answer: 'yes' })).toBeNull();
    expect(validateEvent('organiser_accepted', { role: 'initiator' })).toBeNull();
    // A changed meaning, so a new version: a query can tell the old rows apart.
    expect(catalogue.quiet_interest_answered.version).toBe(2);
    expect(catalogue.quiet_ask_created.version).toBe(2);
    expect(catalogue.organiser_accepted.version).toBe(2);
    // And the ingest drops the old keys rather than storing them.
    expect(acceptEvent('organiser_accepted', { role: 'initiator' })?.properties).toEqual({});
  });

  it('record starting an ask and answering one against nobody', () => {
    expect([...UNATTRIBUTED_EVENTS].sort()).toEqual([
      'quiet_ask_created',
      'quiet_interest_answered',
    ]);
    expect(isUnattributed('quiet_ask_created')).toBe(true);
    expect(isUnattributed('quiet_interest_answered')).toBe(true);
    // Taking the role is public from that moment, so it is anybody's to count.
    expect(isUnattributed('organiser_accepted')).toBe(false);
    expect(isUnattributed('plan_created')).toBe(false);
  });
});
