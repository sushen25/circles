import {
  type Instant,
  type NotificationKind,
  type UserId,
  ONCE,
  addDays,
  addMinutes,
  fromISO,
  fromLocal,
  idempotencyKey,
  occurrenceFor,
  recipientsFor,
  scheduleFor,
  toLocal,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { log } from '../_shared/logging.ts';
import { type PlanContext, loadContext } from './context.ts';

/**
 * The outbox drain: a domain event becomes the notification jobs it implies.
 *
 * Two rules do the load-bearing work here and both are the domain's:
 * `recipientsFor` decides who and on what, and `occurrenceFor` decides which
 * instance of a kind this is — which, through the idempotency key, decides
 * whether a second run of the same event writes anything at all. Everything in
 * this file is plumbing between those two and the database.
 *
 * The map below is the ticket's, and its shape is worth stating: **an event
 * does not become a message; it becomes a set of intentions, each with its own
 * time.** Confirming a meetup produces four — the announcement now, the
 * reminder two hours before it, and the two "did it happen?" letters the next
 * morning — and all four are written at once, as rows with a future
 * `scheduled_for`, so that the reminder exists in the database from the moment
 * the plan is decided rather than depending on a sweep noticing it later.
 */

/** One message this event implies, before anyone has been chosen for it. */
export type Intent = {
  readonly kind: NotificationKind;
  readonly occurrence: string;
  readonly desiredAt: Instant;
  /**
   * Whoever caused it, where a person did and the kind is about their action.
   *
   * Deliberately absent for the clock-caused kinds. `did_it_happen` goes to
   * the organiser, and the organiser is the one who confirmed the meetup: an
   * actor carried across from the confirmation would filter the only recipient
   * the kind has out of its own audience.
   */
  readonly actorId?: string | undefined;
};

export type OutboxEvent = {
  readonly id: string;
  readonly seq: number;
  readonly event_name: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
};

/** The morning after, at nine, where the person reading it is (spec §5.8). */
function nextMorning(after: Instant, at: PlanContext): Instant {
  const local = toLocal(after, at.planZone);
  return fromLocal(addDays(local.date, 1), 9 * 60, at.planZone);
}

/**
 * The kinds one event implies.
 *
 * `null` means the event is not this pipeline's: `communication.contact_verified`
 * is S1-18's and writes its own jobs, and the rest of the catalogue is read by
 * analytics or by nobody. Returning an empty list marks the event processed,
 * which is the right answer for every one of them — an event nothing consumes
 * is not an event that failed.
 */
function intentsFor(event: OutboxEvent, context: PlanContext, now: Instant): readonly Intent[] {
  const confirmation = context.confirmation;

  switch (event.event_name) {
    case 'planning.plan_created':
      return [{ kind: 'new_plan', occurrence: ONCE, desiredAt: now }];

    case 'scheduling.candidates_generated':
      // Once per **revision**, not once per event. Every answer to a `ready`
      // plan takes it ready → collecting → ready, so six members painting and
      // re-painting produce a dozen of these; `ONCE` plus the revision in the
      // key is what makes the organiser's inbox hold one (S1-16).
      return [{ kind: 'options_ready', occurrence: ONCE, desiredAt: now }];

    case 'planning.deadline_passed':
      return [{ kind: 'replies_closed', occurrence: ONCE, desiredAt: now }];

    // Both cancellations, and **with no actor**, which is a decision rather
    // than an omission. A cancel is guarded `organiser_or_owner`, so the
    // person who did it is the organiser *or* the circle's owner, and the
    // event deliberately does not say which: `transition_plan` never names an
    // actor, because on a quiet ask the actor of a cancel is the initiator and
    // that is the one thing the row must never carry (§14).
    //
    // Guessing "the organiser" is right in the common case and silences them
    // about their own plan in the other one — an owner calling off somebody
    // else's meetup. Between telling the person who pressed the button
    // something they already know and telling the organiser nothing, the first
    // is the smaller harm.
    case 'planning.plan_cancelled':
    case 'confirmation.meetup_cancelled':
      return [{ kind: 'cancelled', occurrence: ONCE, desiredAt: now }];

    case 'confirmation.meetup_confirmed': {
      if (confirmation === null) return [];
      const occurrence = occurrenceFor('locked_in', {
        confirmationId: confirmation.id as never,
      });
      const start = fromISO(confirmation.starts_at);
      const morning = nextMorning(fromISO(confirmation.ends_at), context);
      return [
        { kind: 'locked_in', occurrence, desiredAt: now, actorId: confirmation.confirmed_by },
        { kind: 'reminder', occurrence, desiredAt: addMinutes(start, -120) },
        { kind: 'did_it_happen', occurrence, desiredAt: morning },
        { kind: 'did_it_happen_participant', occurrence, desiredAt: morning },
      ];
    }

    case 'confirmation.meetup_rescheduled':
      return [
        {
          kind: 'changed',
          // The event's own id. One event, one message — and *not* `ONCE`,
          // because a place correction does not bump the revision and two
          // changes sharing an occurrence means nobody is told about the
          // second one (`occurrence.ts`).
          occurrence: occurrenceFor('changed', { changeId: event.id }),
          desiredAt: now,
          actorId: context.organiserUserId,
        },
      ];

    default:
      return [];
  }
}

/** A job row, as `public.dispatch_enqueue` takes it. */
export type JobRow = {
  channel: string;
  kind: string;
  user_id: string | null;
  contact_id: string | null;
  plan_id: string;
  plan_revision: number;
  scheduled_for: string;
  idempotency_key: string;
};

/**
 * The organiser kinds, which go to an address rather than to a subscription.
 *
 * They are the ones the domain marks `emailNeedsSubscription: false` — review
 * C6's "email until they install the app" — and the contact they are addressed
 * to is the organiser's own auth address, made a contact by
 * `public.dispatch_organiser_contact` so that a bounce suppresses it like any
 * other (ADR 00XX).
 */
const ORGANISER_KINDS: readonly NotificationKind[] = [
  'options_ready',
  'replies_closed',
  'did_it_happen',
  'about_time',
];

export async function jobRowsFor(
  service: Db,
  context: PlanContext,
  intent: Intent,
  organiserContacts: Map<string, string | null>,
): Promise<readonly JobRow[]> {
  const eligibility = {
    ...context.eligibility,
    ...(intent.actorId === undefined ? {} : { actorId: intent.actorId as UserId }),
  };
  const rows: JobRow[] = [];

  for (const recipient of recipientsFor(intent.kind, eligibility)) {
    const at = scheduleFor(intent.kind, intent.desiredAt, context.zoneOf(recipient.userId));
    const scheduled = new Date(at).toISOString();

    if (recipient.channel === 'push') {
      rows.push({
        channel: 'push',
        kind: intent.kind,
        user_id: recipient.userId,
        contact_id: null,
        plan_id: context.planId,
        plan_revision: context.revision,
        scheduled_for: scheduled,
        idempotency_key: await idempotencyKey({
          channel: 'push',
          recipientId: recipient.userId,
          planId: context.planId as never,
          revision: context.revision,
          kind: intent.kind,
          occurrence: intent.occurrence,
        }),
      });
      continue;
    }

    let contacts: readonly string[];
    if (ORGANISER_KINDS.includes(intent.kind)) {
      if (!organiserContacts.has(recipient.userId)) {
        const { data, error } = await service.rpc('dispatch_organiser_contact', {
          p_user_id: recipient.userId,
        });
        if (error !== null) throw error;
        organiserContacts.set(recipient.userId, (data as string | null) ?? null);
      }
      const contact = organiserContacts.get(recipient.userId) ?? null;
      contacts = contact === null ? [] : [contact];
    } else {
      contacts = context.contactsOf(recipient.userId);
    }

    for (const contactId of contacts) {
      rows.push({
        channel: 'email',
        kind: intent.kind,
        user_id: null,
        contact_id: contactId,
        plan_id: context.planId,
        plan_revision: context.revision,
        scheduled_for: scheduled,
        idempotency_key: await idempotencyKey({
          channel: 'email',
          recipientId: contactId,
          planId: context.planId as never,
          revision: context.revision,
          kind: intent.kind,
          occurrence: intent.occurrence,
        }),
      });
    }
  }

  return rows;
}

/**
 * The revision whose scheduled letters an event calls off.
 *
 * A cancellation leaves the revision where it is; a reschedule has already
 * bumped it by the time this runs, so the reminder and the outcome letters it
 * supersedes are the previous revision's.
 */
function supersededRevision(event: OutboxEvent, context: PlanContext): number | null {
  if (event.event_name === 'confirmation.meetup_cancelled') return context.revision;
  if (event.event_name === 'confirmation.meetup_rescheduled') return context.revision - 1;
  return null;
}

/**
 * The events that say something to somebody.
 *
 * The same list `intentsFor` switches on, held separately so that the drain can
 * tell "this event has nothing to say" from "this event's plan is gone" without
 * reading a context to find out. Adding a case to `intentsFor` without adding
 * its name here makes it silent, which is the one failure worth naming: both
 * places, or neither.
 */
const ANNOUNCED: ReadonlySet<string> = new Set([
  'planning.plan_created',
  'planning.plan_cancelled',
  'planning.deadline_passed',
  'scheduling.candidates_generated',
  'confirmation.meetup_confirmed',
  'confirmation.meetup_rescheduled',
  'confirmation.meetup_cancelled',
]);

export type DrainResult = { events: number; jobs: number; failures: number };

export async function drain(
  service: Db,
  events: readonly OutboxEvent[],
  requestId: string,
  now: Instant,
  deadline: () => boolean,
): Promise<DrainResult> {
  const result: DrainResult = { events: 0, jobs: 0, failures: 0 };
  const contexts = new Map<string, PlanContext | null>();
  const organiserContacts = new Map<string, string | null>();

  for (const event of events) {
    if (deadline()) break;

    try {
      // Only the seven events below produce messages in Slice 1. The rest —
      // memberships, answers, deliveries, growth — are read by analytics and
      // by the health summary, and are marked processed here without a context
      // being read for them: a circle of six answering a plan writes six
      // `response_submitted` events a minute, and reading a plan's whole
      // roster to decide each one says nothing would spend most of the run's
      // budget learning that.
      const planId = ANNOUNCED.has(event.event_name)
        ? event.aggregate_type === 'plan'
          ? event.aggregate_id
          : ((event.payload['plan_id'] as string | undefined) ?? null)
        : null;

      let rows: readonly JobRow[] = [];
      if (planId !== null) {
        if (!contexts.has(planId)) contexts.set(planId, await loadContext(service, planId));
        const context = contexts.get(planId) ?? null;

        if (context !== null) {
          const superseded = supersededRevision(event, context);
          if (superseded !== null) {
            const { error } = await service.rpc('dispatch_cancel_pending', {
              p_plan_id: planId,
              p_revision: superseded,
            });
            if (error !== null) throw error;
          }

          for (const intent of intentsFor(event, context, now)) {
            rows = [...rows, ...(await jobRowsFor(service, context, intent, organiserContacts))];
          }
        }
      }

      if (rows.length > 0) {
        const { data, error } = await service.rpc('dispatch_enqueue', { p_jobs: rows });
        if (error !== null) throw error;
        result.jobs += (data as number | null) ?? 0;
      }

      const { error } = await service.rpc('dispatch_event_result', { p_id: event.id });
      if (error !== null) throw error;
      result.events += 1;
    } catch (thrown) {
      result.failures += 1;
      const code = classify(thrown);
      log('error', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'drain_failed',
        reason: code,
      });
      const { error } = await service.rpc('dispatch_event_result', {
        p_id: event.id,
        p_error: code,
      });
      if (error !== null) throw error;
    }
  }

  return result;
}

/**
 * A failure as a code, never as its text.
 *
 * `outbox_last_error_is_a_code` refuses anything else, and the reason it does
 * is that an exception's message is where an address or a note turns up
 * (non-negotiable 8; S1-11 round 8). The readable half stays in the exception
 * and reaches nothing that is stored.
 */
export function classify(thrown: unknown): string {
  const problem = thrown as { code?: unknown; status?: unknown; name?: unknown };
  // A deadlock between a resend drawing a token and a click spending one is
  // accepted in writing (S1-18): the loser's token is not consumed, so the
  // retry works. It must be a retry and not a failure.
  if (typeof problem.code === 'string' && /^[A-Za-z0-9_.:/-]{1,110}$/.test(problem.code)) {
    return `db:${problem.code}`;
  }
  if (typeof problem.status === 'number') return `http:${problem.status}`;
  if (typeof problem.name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(problem.name)) {
    return `err:${problem.name}`;
  }
  return 'unknown';
}
