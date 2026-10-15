import { validateEvent } from '@circles/contracts';

import type { Db } from '../_shared/db.ts';
import { sha256 } from '../_shared/hash.ts';
import { log } from '../_shared/logging.ts';
import type { PlanContext } from './context.ts';
import type { OutboxEvent } from './events.ts';

/**
 * `quiet_threshold_reached`: the one countable fact about an ask that worked
 * (SUS-97).
 *
 * Recorded by the dispatcher as it drains `planning.threshold_reached`, because
 * nothing else knows the ask opened: no answer tells the client (SUS-51), and
 * the transition happens inside the database.
 *
 * **Against nobody, and about nothing in particular.** No `user_id`, no
 * `anonymous_id`, and no `plan_id` or `circle_id` either, the same as
 * `quiet_ask_created` and `quiet_interest_answered` (ADR 0041, ADR 0072): a plan
 * id here would let a query line an opened ask up against the unattributed
 * events, and through the plan against `private.plan_initiators`. The
 * timestamps are rounded down to the hour for the same reason. To the second,
 * they are a join to this event's own outbox row, which names the plan.
 * `threshold` is the number fixed when the ask was made (ADR 0035), never the
 * count of keen members.
 */

/** An instant rounded down to the hour: fine enough for every count, too coarse to join on. */
function toTheHour(instant: Date): string {
  const rounded = new Date(instant);
  rounded.setUTCMinutes(0, 0, 0);
  return rounded.toISOString();
}

/** The row's id, from the outbox row, so a replay of the event lands on the row already written. */
export async function openedEventId(outboxId: string): Promise<string> {
  const hex = [...(await sha256(`quiet_threshold_reached:${outboxId}`))]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Records that an ask opened. Never throws: the letters are queued and a lost
 * measurement must not undo them or hold the rest of the pass (the cadence
 * pass makes the same choice). Said out loud instead.
 */
export async function recordOpened(
  service: Db,
  event: OutboxEvent,
  context: PlanContext | null,
  requestId: string,
  now: Date,
): Promise<void> {
  if (event.event_name !== 'planning.threshold_reached') return;
  const threshold = context?.eligibility.plan.quietThreshold;
  // A plan that is gone, or one with no threshold, has nothing to count.
  if (threshold === undefined) return;

  const accepted = validateEvent('quiet_threshold_reached', { threshold });
  if (accepted === null) return;

  try {
    const { error } = await service.rpc('record_events', {
      p_rows: [
        {
          event_id: await openedEventId(event.id),
          event_name: accepted.name,
          schema_version: accepted.version,
          user_id: null,
          anonymous_id: null,
          circle_id: null,
          plan_id: null,
          properties: accepted.properties,
          occurred_at: toTheHour(now),
          received_at: toTheHour(now),
        },
      ],
    });
    if (error !== null) throw error;
  } catch {
    log('warn', {
      fn: 'process-scheduled-jobs',
      request_id: requestId,
      event: 'analytics_failed',
      reason: 'quiet_threshold_reached',
    });
  }
}
