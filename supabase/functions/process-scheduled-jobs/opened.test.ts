import { describe, expect, it, vi } from 'vitest';

import type { Db } from '../_shared/db.ts';
import type { PlanContext } from './context.ts';
import type { OutboxEvent } from './events.ts';
import { openedEventId, recordOpened } from './opened.ts';

/**
 * `quiet_threshold_reached` (SUS-97): one row when an ask opens, against
 * nobody, about nothing in particular, and the same row on a replay.
 */

const PLAN = '00000000-0000-4000-8000-0000000000b1';
const OUTBOX = '00000000-0000-4000-8000-0000000000e1';

const opened: OutboxEvent = {
  id: OUTBOX,
  seq: 1,
  event_name: 'planning.threshold_reached',
  aggregate_type: 'plan',
  aggregate_id: PLAN,
  payload: { plan_id: PLAN, keen_count: 5 },
  attempts: 0,
};

const context = (quietThreshold: number | undefined) =>
  ({ eligibility: { plan: { quietThreshold } } }) as unknown as PlanContext;

const NOW = new Date('2026-10-15T14:41:27.123Z');

function service(error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: 1, error });
  return { db: { rpc } as unknown as Db, rpc };
}

describe('an ask that opens is counted', () => {
  it('records the threshold, against nobody, to the hour', async () => {
    const { db, rpc } = service();
    await recordOpened(db, opened, context(3), 'req', NOW);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe('record_events');
    expect(args.p_rows).toEqual([
      {
        event_id: await openedEventId(OUTBOX),
        event_name: 'quiet_threshold_reached',
        schema_version: 1,
        user_id: null,
        anonymous_id: null,
        circle_id: null,
        plan_id: null,
        // The number fixed when the ask was made, not the keen count (5).
        properties: { threshold: 3 },
        occurred_at: '2026-10-15T14:00:00.000Z',
        received_at: '2026-10-15T14:00:00.000Z',
      },
    ]);
  });

  it('derives the id from the outbox row: a replay lands on the same row, another event does not', async () => {
    expect(await openedEventId(OUTBOX)).toBe(await openedEventId(OUTBOX));
    expect(await openedEventId(OUTBOX)).not.toBe(
      await openedEventId('00000000-0000-4000-8000-0000000000e2'),
    );
    expect(await openedEventId(OUTBOX)).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });

  it('records nothing for any other event, or for a plan with no threshold', async () => {
    const { db, rpc } = service();
    await recordOpened(
      db,
      { ...opened, event_name: 'planning.plan_expired' },
      context(3),
      'r',
      NOW,
    );
    await recordOpened(db, opened, context(undefined), 'r', NOW);
    await recordOpened(db, opened, null, 'r', NOW);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not throw when the measurement is lost', async () => {
    const { db } = service({ code: '57014' });
    await expect(recordOpened(db, opened, context(3), 'req', NOW)).resolves.toBeUndefined();
  });
});
