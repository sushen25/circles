import {
  type DurationMinutes,
  type Instant,
  defaultDeadline,
  isQuietPreset,
  lastPossibleStart,
  localDate,
  zone,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { log } from '../_shared/logging.ts';
import { classify } from './drain.ts';

/**
 * The sweep's half of a held quiet ask (ADR 0035): an ask that met its
 * threshold while its circle had a plan finding a time stays `seeking`, and is
 * tried again here once the circle is free — and on every answer, by
 * `record_interest`. Whichever comes first opens it; the other finds nothing.
 */

/** A held ask as `dispatch_timed_work` names it: its id, and what its deadline needs. */
export type HeldAsk = {
  readonly id: string;
  readonly preset: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly daily_start_local: number;
  readonly daily_end_local: number;
  readonly duration_minutes: number;
  readonly time_zone: string;
};

/**
 * Try again to open each ask held at its threshold beside an open plan, now
 * that its circle is free (ADR 0035). The deadline is the domain's for this
 * moment; the crossing, and whether it still may, is the database's under the
 * plan's lock. Returns how many opened.
 */
export async function openHeldAsks(
  service: Db,
  held: readonly HeldAsk[],
  now: Instant,
  requestId: string,
  outOfTime: () => boolean,
): Promise<number> {
  let opened = 0;
  for (const ask of held) {
    if (outOfTime()) break;
    if (!isQuietPreset(ask.preset as never)) continue;
    const latest = lastPossibleStart({
      window: { start: localDate(ask.window_start), end: localDate(ask.window_end) },
      daily: { startMin: ask.daily_start_local, endMin: ask.daily_end_local },
      durationMinutes: ask.duration_minutes as DurationMinutes,
      zone: zone(ask.time_zone),
    });
    const deadline = defaultDeadline(ask.preset as never, now, latest);
    if (deadline === undefined) continue;
    try {
      const { data, error } = await service.rpc('dispatch_open_quiet_ask', {
        p_plan_id: ask.id,
        p_deadline: new Date(deadline).toISOString(),
      });
      if (error !== null) throw error;
      if (data === true) opened += 1;
    } catch (thrown) {
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'held_ask_failed',
        reason: classify(thrown),
      });
    }
  }
  return opened;
}
