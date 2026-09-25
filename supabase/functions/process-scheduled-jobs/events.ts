import {
  type Instant,
  type NotificationKind,
  type Zone,
  ONCE,
  addMinutes,
  fromISO,
  morningAfter,
  occurrenceFor,
} from '@circles/domain';

import { handedOverIntents, repliesClosedIntent } from './closing.ts';
import type { PlanContext } from './context.ts';

/**
 * What one domain event says, and to whom — before anybody has been chosen.
 *
 * An event does not become a message; it becomes a set of **intentions**, each
 * with its own time. Confirming a meetup produces four — the announcement now,
 * the reminder two hours before it, and the two "did it happen?" letters the
 * next morning — and all four are written at once, as rows with a future
 * `scheduled_for`, so that the reminder exists in the database from the moment
 * the plan is decided rather than depending on a sweep noticing it later.
 */

export type OutboxEvent = {
  readonly id: string;
  readonly seq: number;
  readonly event_name: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
};

export type Intent = {
  readonly kind: NotificationKind;
  readonly occurrence: string;
  /**
   * When it is wanted.
   *
   * A function when the answer depends on where the reader is: "nine the next
   * morning" is nine o'clock *for them*, and a London organiser of a Melbourne
   * meetup would otherwise be sent it at midnight, held by quiet hours, and
   * receive it a day and a half after the evening it asks about.
   */
  readonly desiredAt: Instant | ((zone: Zone) => Instant);
  /**
   * An instant after which the message is pointless and is not written at all.
   *
   * The reminder has one and it is the meetup's start. Quiet hours move a held
   * message to the next 08:00 and never earlier, so a 7:30 breakfast wants its
   * reminder at 5:30, which is inside the quiet window, which is 08:00 — half
   * an hour after everyone sat down. Better nothing than that.
   */
  readonly notAfter?: Instant | undefined;
  /**
   * Whoever caused it, where a person did and the kind is about their action.
   *
   * Deliberately absent for the kinds a clock causes. `did_it_happen` goes to
   * the organiser, and the organiser is the one who confirmed the meetup: an
   * actor carried across from the confirmation would filter the only recipient
   * the kind has out of its own audience.
   */
  readonly actorId?: string | undefined;
};

/**
 * The events that say something to somebody.
 *
 * The same list `intentsFor` switches on, held separately so that the drain can
 * tell "this event has nothing to say" from "this event's plan is gone" without
 * reading a context to find out. Adding a case below without adding its name
 * here makes it silent, which is the one failure worth naming: both places, or
 * neither.
 */
export const ANNOUNCED: ReadonlySet<string> = new Set([
  'planning.plan_created',
  'planning.plan_cancelled',
  'planning.deadline_passed',
  'planning.organiser_changed',
  'scheduling.candidates_generated',
  'confirmation.meetup_confirmed',
  'confirmation.meetup_rescheduled',
  'confirmation.meetup_cancelled',
  // The quiet ask (S2-02). `plan_expired` speaks only for an ask that never
  // opened; for every other plan `intentsFor` returns nothing.
  'planning.quiet_ask_created',
  'planning.threshold_reached',
  'planning.plan_expired',
]);

/** Nine the next morning, where the reader is: the domain's rule, per recipient. */
function morningAfterFor(end: Instant): (zone: Zone) => Instant {
  return (zone) => morningAfter(end, zone);
}

/**
 * The kinds one event implies.
 *
 * An empty list marks the event processed, which is the right answer for every
 * event this pipeline does not speak for: `communication.contact_verified` is
 * S1-18's and writes its own jobs, and the rest of the catalogue is read by
 * analytics or by nobody. An event nothing consumes is not an event that
 * failed.
 */
export function intentsFor(
  event: OutboxEvent,
  context: PlanContext,
  now: Instant,
): readonly Intent[] {
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

    // Once per deadline, and once more a day later (S2-05, `closing.ts`).
    case 'planning.deadline_passed':
      return [repliesClosedIntent(event, context, now)];

    // A hand-off: the new organiser is told what is waiting for them.
    case 'planning.organiser_changed':
      return handedOverIntents(context, now);

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
      const morning = morningAfterFor(fromISO(confirmation.ends_at));
      return [
        { kind: 'locked_in', occurrence, desiredAt: now, actorId: confirmation.confirmed_by },
        { kind: 'reminder', occurrence, desiredAt: addMinutes(start, -120), notAfter: start },
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

    // The quiet ask (S2-02). Who each is for — everybody but the initiator,
    // the initiator, the keen members — is `recipientsFor`'s, from facts the
    // drain reads for these kinds alone (`quiet.ts`). Nothing here names
    // anybody, and no actor is carried: on a quiet ask the actor of the
    // creation is the initiator.
    // Not about an ask that has stopped asking by the time the drain reads it:
    // withdrawn in the first minute is "closed privately, nobody told" (§9).
    case 'planning.quiet_ask_created':
      return context.planState === 'seeking'
        ? [{ kind: 'quiet_ask', occurrence: ONCE, desiredAt: now }]
        : [];

    case 'planning.threshold_reached':
      return [
        { kind: 'threshold_initiator', occurrence: ONCE, desiredAt: now },
        { kind: 'threshold_keen', occurrence: ONCE, desiredAt: now },
      ];

    // "Not enough people were free this time" — only for an ask that expired
    // *from seeking*, which is the event's own `from_state`. A quiet plan that
    // opened and later ran past its last start expired too, and closing
    // "quietly" is not what happened to it (SUS-49 note 11). A withdrawn ask
    // emits nothing at all (`event_for`).
    case 'planning.plan_expired':
      return event.payload['mode'] === 'quiet' && event.payload['from_state'] === 'seeking'
        ? [{ kind: 'quiet_expired', occurrence: ONCE, desiredAt: now }]
        : [];

    default:
      return [];
  }
}

/**
 * The revision whose scheduled letters an event calls off.
 *
 * **Read from the event, never from the plan as it is now.** A context is
 * loaded once per plan per run, after every event in the batch has happened,
 * and "reopen, then fix the window" is the ordinary shape of a reschedule —
 * two bumps in one tick. Taking the plan's current revision and subtracting
 * one then names a revision that was never confirmed, and the evening that was
 * actually called off keeps its reminder and both morning-after letters for
 * ever. Every transition event carries the revision it left the plan at
 * (S1-11), which is the number that cannot drift.
 */
export function revisionOf(event: OutboxEvent): number | null {
  const revision = event.payload['revision'];
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 1
    ? revision
    : null;
}

export function supersededRevision(event: OutboxEvent): number | null {
  const revision = revisionOf(event);
  if (revision === null) return null;
  // A cancellation leaves the revision where it is; a reschedule has already
  // bumped it, so what it supersedes is the one before.
  if (event.event_name === 'confirmation.meetup_cancelled') return revision;
  if (event.event_name === 'confirmation.meetup_rescheduled') return revision - 1;
  return null;
}
