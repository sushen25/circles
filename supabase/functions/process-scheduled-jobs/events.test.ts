import { DOMAIN_EVENT_NAMES, instant, zone } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import type { PlanContext } from './context.ts';
import { ANNOUNCED, type OutboxEvent, intentsFor, supersededRevision } from './events.ts';

/**
 * The two lists that have to agree, made to prove it.
 *
 * `ANNOUNCED` lets the drain skip reading a plan for an event that says nothing
 * to anybody, and `intentsFor` says what each one does say. A case added to the
 * switch without its name in the set is a message nobody ever receives, and
 * nothing about either file would look wrong. The comment in `events.ts` asks
 * for both or neither; this is what makes that true.
 *
 * Run over the whole event catalogue rather than over a list written here, so
 * that an event added to `DOMAIN_EVENT_NAMES` is covered the day it lands.
 */

const PLAN = '00000000-0000-4000-8000-0000000000b1';
const CONFIRMATION = '00000000-0000-4000-8000-0000000000f1';

/** Enough of a context for every branch of the switch to reach its answer. */
const context = {
  planId: PLAN,
  circleId: '00000000-0000-4000-8000-0000000000c1',
  circleName: 'Sunday Crew',
  planCode: 'pnsundaycr',
  planState: 'confirmed',
  planZone: zone('Australia/Melbourne'),
  revision: 2,
  organiserUserId: '00000000-0000-4000-8000-000000000001',
  organiserName: 'Maya',
  cancelNote: undefined,
  confirmation: {
    id: CONFIRMATION,
    revision: 2,
    starts_at: '2026-09-17T08:30:00.000Z',
    ends_at: '2026-09-17T10:30:00.000Z',
    place_name: null,
    note: null,
    status: 'active',
    confirmed_by: '00000000-0000-4000-8000-000000000001',
    available_user_ids: [],
  },
  supersededConfirmation: null,
  bestCandidate: null,
  zoneOf: () => zone('Australia/Melbourne'),
  contactsOf: () => [],
  eligibility: {} as PlanContext['eligibility'],
} as unknown as PlanContext;

const eventNamed = (name: string): OutboxEvent => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  seq: 1,
  event_name: name,
  aggregate_type: 'plan',
  aggregate_id: PLAN,
  payload: { plan_id: PLAN, revision: 2 },
  attempts: 0,
});

describe('which events say something', () => {
  it('has a name in ANNOUNCED for every event that produces a message', () => {
    const speaks = DOMAIN_EVENT_NAMES.filter(
      (name) => intentsFor(eventNamed(name), context, instant(0)).length > 0,
    );

    expect([...speaks].sort()).toEqual([...ANNOUNCED].sort());
  });

  it('names only events that exist', () => {
    // A typo in the set is an event that is read as silent for ever, and the
    // outbox's own check constraint would never see it.
    for (const name of ANNOUNCED) {
      expect(DOMAIN_EVENT_NAMES).toContain(name);
    }
  });
});

describe('which revision a cancellation supersedes', () => {
  it('reads it from the event, because the plan has moved on by now', () => {
    // A reschedule bumped the plan to 2; what it superseded was 1. The plan
    // may be at 5 by the time this runs, and `context.revision - 1` would then
    // name a revision that was never confirmed.
    expect(supersededRevision(eventNamed('confirmation.meetup_rescheduled'))).toBe(1);
    expect(supersededRevision(eventNamed('confirmation.meetup_cancelled'))).toBe(2);
  });

  it('answers nothing for an event that supersedes nothing, and for one with no revision', () => {
    expect(supersededRevision(eventNamed('confirmation.meetup_confirmed'))).toBeNull();
    expect(
      supersededRevision({ ...eventNamed('confirmation.meetup_cancelled'), payload: {} }),
    ).toBeNull();
  });
});
