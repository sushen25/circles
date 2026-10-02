import {
  ANSWERABLE_STATES,
  type Instant,
  type NotificationKind,
  type PlanState,
  type Zone,
  ONCE,
  addMinutes,
  fromISO,
  morningAfter,
  occurrenceFor,
} from '@circles/domain';

import { handedOverIntents, repliesClosedIntent } from './closing.ts';
import { revisionOf, speaksForAnother } from './revisions.ts';
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
  /** The confirmation a letter about one evening is for, so a move can tell its own letters from the ones it replaced. */
  readonly confirmationId?: string | undefined;
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
  // Only an `edit`, which cleared the answers. An `adjust` is the same event
  // and asks nobody again (ADR 0017), so `intentsFor` returns nothing for it.
  'planning.plan_revised',
  'scheduling.candidates_generated',
  'confirmation.meetup_confirmed',
  'confirmation.meetup_rescheduled',
  // The organiser moved a locked-in time without asking anybody again
  // (ADR 0050).
  'confirmation.meetup_moved',
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
 * The four letters about one evening: the news (`locked_in`, or `moved` after the
 * organiser moved it), the reminder two hours before, and the two morning-after
 * ones. All keyed by the confirmation, so a move can take back the ones it
 * replaced and keep these (ADR 0050).
 */
function eveningIntents(
  first: 'locked_in' | 'moved',
  confirmation: NonNullable<PlanContext['confirmation']>,
  now: Instant,
): readonly Intent[] {
  const occurrence = occurrenceFor(first, { confirmationId: confirmation.id as never });
  const start = fromISO(confirmation.starts_at);
  const morning = morningAfterFor(fromISO(confirmation.ends_at));
  const id = confirmation.id;
  return [
    {
      kind: first,
      occurrence,
      desiredAt: now,
      actorId: confirmation.confirmed_by,
      confirmationId: id,
    },
    {
      kind: 'reminder',
      occurrence,
      desiredAt: addMinutes(start, -120),
      notAfter: start,
      confirmationId: id,
    },
    { kind: 'did_it_happen', occurrence, desiredAt: morning, confirmationId: id },
    { kind: 'did_it_happen_participant', occurrence, desiredAt: morning, confirmationId: id },
  ];
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

    // "The plan changed, add your times again" (ADR 0046), to the people whose
    // answers the edit cleared. Once per **revision** — `ONCE`, and the
    // revision is in the key — so a run of edits is one letter per question
    // asked and never one per outbox row.
    //
    // Not for an `adjust` (quorum, deadline, required members), which keeps
    // the revision and every answer (ADR 0017). And not for an edit the plan
    // has already moved past: a context is read after every event in the
    // batch, and an edit followed by another edit, or by a reopen, has its own
    // event to say what is being asked now. Nor for a plan no longer taking
    // answers by the time this runs.
    //
    // The organiser made the edit and is not told about it. Read from the
    // event, because only the organiser can edit and the plan may have been
    // handed on since.
    case 'planning.plan_revised': {
      if (event.payload['action'] !== 'edit') return [];
      if (revisionOf(event) !== context.revision) return [];
      if (!ANSWERABLE_STATES.includes(context.planState as PlanState)) return [];
      const editor = event.payload['organiser_user_id'];
      return [
        {
          kind: 'asked_again',
          occurrence: ONCE,
          desiredAt: now,
          actorId: typeof editor === 'string' ? editor : context.organiserUserId,
        },
      ];
    }

    // Once per deadline, and once more a day later (S2-05, `closing.ts`).
    case 'planning.deadline_passed':
      return [repliesClosedIntent(event, context, now)];

    // A hand-off: the new organiser is told what is waiting for them.
    case 'planning.organiser_changed':
      return handedOverIntents(event, context, now);

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
      // Locked in and then moved before this ran (ADR 0050): the move's event
      // speaks, about the time the plan is at now.
      if (speaksForAnother(event, confirmation)) return [];
      return eveningIntents('locked_in', confirmation, now);
    }

    // The organiser moved a locked-in time (ADR 0050): the plan's members are
    // told once, and the reminder and the morning-after letters follow the new
    // time. The letters queued for the old one were taken back by `drain`
    // (`supersededRevision`) before these are written, and the occurrence is the
    // **new confirmation's**, like a fresh lock-in's: a second move is a second
    // message, and the same move read twice is one. Read from the context, not
    // the event, so a plan moved twice in one tick tells people where it is, once.
    case 'confirmation.meetup_moved': {
      if (confirmation === null) return [];
      if (speaksForAnother(event, confirmation)) return [];
      return eveningIntents('moved', confirmation, now);
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

export { revisionOf, speaksForAnother, supersededRevision } from './revisions.ts';
