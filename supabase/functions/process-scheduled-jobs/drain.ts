import {
  type Instant,
  type NotificationKind,
  type UserId,
  idempotencyKey,
  notificationSpec,
  recipientsFor,
  scheduleFor,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { log } from '../_shared/logging.ts';
import { type PlanContext, loadContext } from './context.ts';
import {
  ANNOUNCED,
  type Intent,
  type OutboxEvent,
  intentsFor,
  revisionOf,
  supersededRevision,
} from './events.ts';

/**
 * The outbox drain: a domain event becomes the notification jobs it implies.
 *
 * Two rules do the load-bearing work here and both are the domain's:
 * `recipientsFor` decides who and on what, and `occurrenceFor` decides which
 * instance of a kind this is — which, through the idempotency key, decides
 * whether a second run of the same event writes anything at all. Everything in
 * this file is plumbing between those two and the database; what each event
 * says is `events.ts`.
 */

/** A job row, as `public.dispatch_enqueue` takes it. */
export type JobRow = {
  channel: string;
  kind: string;
  user_id: string | null;
  contact_id: string | null;
  /** Null only for `about_time`, which belongs to a circle (S2-04). */
  plan_id: string | null;
  plan_revision: number | null;
  /** Set only for `about_time`: the circle it belongs to, since it has no plan. */
  circle_id?: string | null;
  scheduled_for: string;
  idempotency_key: string;
};

/**
 * Whether this kind is addressed to somebody's own address rather than to a
 * subscription they asked for.
 *
 * Read off the domain's table rather than listed here. `emailNeedsSubscription`
 * is false for exactly the four organiser kinds — review C6's "email until they
 * install the app" — and for `verify_email`, which never reaches this branch
 * because its audience is an address and `recipientsFor` returns nobody for it.
 * A list would be a second copy of a rule that already exists, and the day a
 * kind moves between the two it is the copy that would be wrong.
 *
 * The contact they are addressed to is the person's own auth address, made a
 * contact by `public.dispatch_organiser_contact` so that a bounce suppresses it
 * like any other (ADR 0027).
 */
function addressedPersonally(kind: NotificationKind): boolean {
  return !notificationSpec(kind).emailNeedsSubscription;
}

export async function jobRowsFor(
  service: Db,
  context: PlanContext,
  intent: Intent,
  organiserContacts: Map<string, string | null>,
  requestId = 'unknown',
  /**
   * The revision this message belongs to, which is the **event's** and not the
   * plan's as it is now.
   *
   * Round 1 moved the *cancelled* revision to the event for this reason and
   * left the written one behind, which round 2 found: a context is read once
   * per run, after every event in the batch, so a `candidates_generated` for
   * revision 1 arriving in the same tick as an `edit` to revision 2 wrote
   * revision 2's job — and spent revision 2's only `options_ready` key on a
   * set that cannot exist yet. Three retries later it is `failed`, and when
   * revision 2's options really do appear the key is gone and the organiser is
   * never told.
   */
  revision = context.revision,
): Promise<readonly JobRow[]> {
  const eligibility = {
    ...context.eligibility,
    ...(intent.actorId === undefined ? {} : { actorId: intent.actorId as UserId }),
  };
  const rows: JobRow[] = [];

  for (const recipient of recipientsFor(intent.kind, eligibility)) {
    const zone = context.zoneOf(recipient.userId);
    const wanted =
      typeof intent.desiredAt === 'function' ? intent.desiredAt(zone) : intent.desiredAt;
    const at = scheduleFor(intent.kind, wanted, zone);
    // Quiet hours only ever move a message later, so a message with a shelf
    // life can be moved off the end of it. A reminder that would arrive after
    // everyone sat down is not sent.
    if (intent.notAfter !== undefined && at >= intent.notAfter) continue;
    const scheduled = new Date(at).toISOString();

    if (recipient.channel === 'push') {
      rows.push({
        channel: 'push',
        kind: intent.kind,
        user_id: recipient.userId,
        contact_id: null,
        plan_id: context.planId,
        plan_revision: revision,
        scheduled_for: scheduled,
        idempotency_key: await idempotencyKey({
          channel: 'push',
          recipientId: recipient.userId,
          planId: context.planId as never,
          revision,
          kind: intent.kind,
          occurrence: intent.occurrence,
        }),
      });
      continue;
    }

    let contacts: readonly string[];
    if (addressedPersonally(intent.kind)) {
      if (!organiserContacts.has(recipient.userId)) {
        const { data, error } = await service.rpc('dispatch_organiser_contact', {
          p_user_id: recipient.userId,
        });
        if (error !== null) throw error;
        organiserContacts.set(recipient.userId, (data as string | null) ?? null);
      }
      const contact = organiserContacts.get(recipient.userId) ?? null;
      // An organiser with no address we may write to is silence, which is an
      // ordinary answer — and an invisible one, so it is said out loud. It is
      // also the state S4-06's diagnostics screen will want to show, and the
      // only way anybody would notice that a whole circle's organiser mail is
      // going nowhere.
      if (contact === null) {
        log('warn', {
          fn: 'process-scheduled-jobs',
          request_id: requestId,
          event: 'organiser_unreachable',
          reason: intent.kind,
        });
      }
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
        plan_revision: revision,
        scheduled_for: scheduled,
        idempotency_key: await idempotencyKey({
          channel: 'email',
          recipientId: contactId,
          planId: context.planId as never,
          revision,
          kind: intent.kind,
          occurrence: intent.occurrence,
        }),
      });
    }
  }

  return rows;
}

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
      // Only the seven events in `ANNOUNCED` produce messages in Slice 1. The
      // rest — memberships, answers, deliveries, growth — are marked processed
      // here without a context being read for them: a circle of six answering
      // a plan writes six `response_submitted` events a minute, and reading a
      // plan's whole roster to decide each one says nothing would spend most
      // of the run's budget learning that.
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
          const superseded = supersededRevision(event);
          if (superseded !== null) {
            const { error } = await service.rpc('dispatch_cancel_pending', {
              p_plan_id: planId,
              p_revision: superseded,
            });
            if (error !== null) throw error;
          }

          for (const intent of intentsFor(event, context, now)) {
            rows = [
              ...rows,
              ...(await jobRowsFor(
                service,
                context,
                intent,
                organiserContacts,
                requestId,
                revisionOf(event) ?? context.revision,
              )),
            ];
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
  return CODE.test(guess(thrown)) ? guess(thrown) : 'unknown';
}

/** The shape both `last_error` columns are constrained to. */
const CODE = /^[A-Za-z0-9_.:/-]{1,120}$/;

function guess(thrown: unknown): string {
  const problem = thrown as { code?: unknown; status?: unknown; name?: unknown };
  // A deadlock between a resend drawing a token and a click spending one is
  // accepted in writing (S1-18): the loser's token is not consumed, so the
  // retry works. It must be a retry and not a failure.
  if (typeof problem.code === 'string' && /^[A-Za-z0-9_.:/-]{1,110}$/.test(problem.code)) {
    return `db:${problem.code}`;
  }
  if (typeof problem.status === 'number' && Number.isSafeInteger(problem.status)) {
    return `http:${problem.status}`;
  }
  if (typeof problem.name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(problem.name)) {
    return `err:${problem.name}`;
  }
  return 'unknown';
}

export type { Intent, OutboxEvent } from './events.ts';
