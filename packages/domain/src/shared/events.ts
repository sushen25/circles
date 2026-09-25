import type { Instant } from './instant.js';

/**
 * Domain events (architecture §6.3).
 *
 * Aggregates emit these; the same transaction that changes state writes them to
 * the outbox; the scheduled dispatcher turns them into notifications and
 * analytics. Names are past tense and namespaced by context, because an event
 * is a record of something that happened, not an instruction.
 *
 * This list is also the check constraint on `jobs.outbox.event_name`:
 * `scripts/gen-events.mjs` renders it into the migration and `pnpm check`
 * fails if the two have drifted. Add a name here, run `pnpm gen:events`.
 *
 * Payloads are `unknown` until each context lands in Slice 1. The names are
 * fixed now so the outbox, the dispatcher and the tests can be written against
 * a closed set rather than a string.
 */
export const DOMAIN_EVENT_NAMES = [
  'circles.circle_created',
  'circles.member_joined',
  'circles.member_removed',
  'circles.invite_rotated',
  'circles.member_reattached',

  'planning.plan_created',
  'planning.plan_revised',
  'planning.plan_expired',
  'planning.plan_cancelled',
  'planning.quiet_ask_created',
  'planning.interest_recorded',
  'planning.threshold_reached',
  'planning.organiser_accepted',
  'planning.organiser_changed',
  'planning.deadline_passed',

  'availability.response_submitted',
  'availability.response_cleared',

  'scheduling.candidates_generated',
  'scheduling.no_eligible_candidates',

  'confirmation.meetup_confirmed',
  'confirmation.meetup_rescheduled',
  'confirmation.meetup_cancelled',
  'confirmation.attendance_updated',
  'confirmation.outcome_reported',

  'communication.contact_verified',
  'communication.subscription_changed',
  'communication.delivery_recorded',

  'growth.nudge_shown',
  'growth.nudge_answered',
  'growth.account_claimed',
  'growth.app_first_open_linked',
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

export type DomainEvent<Name extends DomainEventName = DomainEventName, Payload = unknown> = {
  readonly name: Name;
  readonly occurredAt: Instant;
  readonly payload: Payload;
};

export function domainEvent<Name extends DomainEventName, Payload>(
  name: Name,
  occurredAt: Instant,
  payload: Payload,
): DomainEvent<Name, Payload> {
  return { name, occurredAt, payload };
}

/** The context an event belongs to — the part before the dot. */
export function contextOf(name: DomainEventName): string {
  return name.split('.')[0]!;
}
