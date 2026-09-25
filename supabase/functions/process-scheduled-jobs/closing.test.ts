import { FOLLOW_UP, addMinutes, fromISO, instant, zone } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { closingHeld, handedOverIntents, repliesClosedIntent } from './closing.ts';
import type { PlanContext } from './context.ts';
import type { OutboxEvent } from './events.ts';
import type { DueJob } from './send.ts';

/**
 * Replies closed with no decision (S2-05), at the two moments the dispatcher
 * decides anything about it: when the event becomes a letter, and when the
 * letter is about to go.
 *
 * The ticket's test — "both reminders sent once each; none after confirmation"
 * — is these two halves: each letter has a key of its own, so neither is
 * swallowed as the other's duplicate and neither is written twice; and a
 * letter that has stopped being true by the time it is due is not sent.
 */

const PLAN = '00000000-0000-4000-8000-0000000000b1';
const MAYA = '00000000-0000-4000-8000-0000000000a1';
const PRIYA = '00000000-0000-4000-8000-0000000000a2';
const DEADLINE = fromISO('2026-09-15T08:00:00.000Z');
const NOW = addMinutes(DEADLINE, 120);

function contextOf(overrides: {
  state?: string;
  organiser?: string;
  deadline?: ReturnType<typeof fromISO>;
}): PlanContext {
  return {
    planId: PLAN,
    planState: overrides.state ?? 'ready',
    planZone: zone('Australia/Melbourne'),
    revision: 1,
    organiserUserId: overrides.organiser ?? MAYA,
    eligibility: { plan: { responseDeadline: overrides.deadline ?? DEADLINE } },
  } as unknown as PlanContext;
}

const closed = (payload: Record<string, unknown>): OutboxEvent => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  seq: 1,
  event_name: 'planning.deadline_passed',
  aggregate_type: 'plan',
  aggregate_id: PLAN,
  payload: { plan_id: PLAN, revision: 1, ...payload },
  attempts: 0,
});

const due = (kind: string, userId: string): DueJob =>
  ({ id: 'job-1', kind, user_id: userId, plan_id: PLAN, plan_revision: 1 }) as unknown as DueJob;

describe('the letters replies closing writes', () => {
  it('gives the deadline, the extended deadline and the day-after reminder three keys', () => {
    const first = repliesClosedIntent(
      closed({ deadline: '2026-09-15T08:00:00.000000+00:00' }),
      contextOf({}),
      NOW,
    );
    const followUp = repliesClosedIntent(
      closed({ deadline: '2026-09-15T08:00:00.000000+00:00', follow_up: FOLLOW_UP }),
      contextOf({}),
      NOW,
    );
    const extended = repliesClosedIntent(
      closed({ deadline: '2026-09-16T10:00:00.000000+00:00' }),
      contextOf({}),
      NOW,
    );
    expect(first.kind).toBe('replies_closed');
    expect(new Set([first.occurrence, followUp.occurrence, extended.occurrence]).size).toBe(3);
  });

  it('keys a letter on the deadline the sweep saw, not the one the plan has by the time it drains', () => {
    // Extended between the sweep and the drain: the old deadline's letter must
    // not spend the new deadline's key, or the new one is never announced.
    const later = contextOf({ deadline: fromISO('2026-09-16T10:00:00.000Z') });
    const stamped = repliesClosedIntent(
      closed({ deadline: '2026-09-15T08:00:00.000000+00:00' }),
      later,
      NOW,
    );
    const unstamped = repliesClosedIntent(closed({}), contextOf({}), NOW);
    expect(stamped.occurrence).toBe(unstamped.occurrence);
  });
});

describe('what a hand-off tells the new organiser', () => {
  it('replies closed: the letter that opens the three ways out', () => {
    const [intent, ...rest] = handedOverIntents(contextOf({ organiser: PRIYA }), NOW);
    expect(rest).toEqual([]);
    expect(intent?.kind).toBe('replies_closed');
  });

  it('options on offer and replies still open: options ready', () => {
    const open = contextOf({ organiser: PRIYA, deadline: addMinutes(NOW, 60) });
    expect(handedOverIntents(open, NOW).map((i) => i.kind)).toEqual(['options_ready']);
  });

  it('still collecting before the deadline, or already locked in: nothing yet', () => {
    const collecting = contextOf({ state: 'collecting', deadline: addMinutes(NOW, 60) });
    expect(handedOverIntents(collecting, NOW)).toEqual([]);
    expect(handedOverIntents(contextOf({ state: 'confirmed' }), NOW)).toEqual([]);
  });
});

describe('a letter that has stopped being true', () => {
  it('goes while it is true', () => {
    expect(closingHeld(due('replies_closed', MAYA), contextOf({}), NOW)).toBeUndefined();
    expect(closingHeld(due('options_ready', MAYA), contextOf({}), NOW)).toBeUndefined();
  });

  it('is not sent once the plan is locked in: none after confirmation', () => {
    expect(closingHeld(due('replies_closed', MAYA), contextOf({ state: 'confirmed' }), NOW)).toBe(
      'already_decided',
    );
  });

  it('is not sent once replies have reopened for one more day', () => {
    const extended = contextOf({ deadline: addMinutes(NOW, 24 * 60) });
    expect(closingHeld(due('replies_closed', MAYA), extended, NOW)).toBe('replies_reopened');
  });

  it('is not sent to somebody who has handed the plan on', () => {
    const handed = contextOf({ organiser: PRIYA });
    for (const kind of ['replies_closed', 'options_ready', 'did_it_happen']) {
      expect(closingHeld(due(kind, MAYA), handed, NOW), kind).toBe('organiser_changed');
    }
  });

  it('leaves every member kind alone', () => {
    const handed = contextOf({ organiser: PRIYA, state: 'confirmed' });
    for (const kind of ['locked_in', 'reminder', 'cancelled', 'did_it_happen_participant']) {
      expect(closingHeld(due(kind, MAYA), handed, NOW), kind).toBeUndefined();
    }
    expect(closingHeld(due('replies_closed', MAYA), null, instant(0))).toBeUndefined();
  });
});
