import type { OutboxEvent } from './events.ts';

/**
 * Whether an event is about a confirmation that is no longer the plan's active
 * one: a lock-in the organiser has since moved, or a move since moved again. An
 * event from before `confirmation_id` was in its payload names none, and speaks
 * as it always did.
 */
export function speaksForAnother(
  event: OutboxEvent,
  confirmation: { readonly id: string; readonly moved_from_starts_at?: string | null | undefined },
): boolean {
  const named = event.payload['confirmation_id'];
  if (typeof named === 'string') return named !== confirmation.id;
  // An event from before the id was in the payload names none. A lock-in the plan
  // has since moved is told by the move's own event, so it stays quiet; one for a
  // plan that was never moved speaks as it always did.
  return (
    event.event_name === 'confirmation.meetup_confirmed' &&
    typeof confirmation.moved_from_starts_at === 'string'
  );
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
  // A move keeps the revision (ADR 0050): what it supersedes is this
  // revision's letters about the time it just left, not the one before's.
  if (event.event_name === 'confirmation.meetup_moved') return revision;
  if (event.event_name === 'confirmation.meetup_rescheduled') return revision - 1;
  return null;
}
