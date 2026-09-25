import { deadlineReminderDue, type Instant, ONCE } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { recalculate } from '../_shared/engine.ts';
import { log } from '../_shared/logging.ts';
import { cadenceWork } from './cadence.ts';
import { loadContext } from './context.ts';
import { classify, jobRowsFor } from './drain.ts';
import { type HeldAsk, openHeldAsks } from './quiet-held.ts';

/**
 * The work a clock creates (architecture §9.3: "discovered from data …, never
 * from in-memory timers").
 *
 * `public.dispatch_timed_work` does the two halves that are writes — emitting
 * `planning.deadline_passed` once per plan, and expiring a plan whose last
 * possible start has gone — and names the three that need the domain: the plans
 * whose candidate set is stale, the plans whose deadline is a day away, and
 * the circles that may be due a cadence nudge (`cadence.ts`, S2-04).
 *
 * **The recalculation runs in this process rather than over HTTP.** S1-16 left
 * `recalculate-candidates` as the endpoint for "a case no member's request
 * covers", and the endpoint is still there and still internal; but the work
 * itself is `_shared/engine.ts`, which this function can import. Calling the
 * endpoint would mean the dispatcher holding the same `CRON_SECRET` it was
 * called with, knowing its own functions URL, and paying a round trip per
 * plan — three pieces of configuration to reach a module that is already in
 * the bundle. One decision, recorded in the PR: the endpoint stays for the
 * cases that come from outside.
 */

export type TimedResult = {
  deadlinesClosed: number;
  expired: number;
  expireRefused: number;
  recalculated: number;
  recalculateFailed: number;
  remindersQueued: number;
  /** Cadence due dates decided this run (to one person, or to nobody). */
  cadencePrompted: number;
  nudgesQueued: number;
  /** Quiet asks closed at their stop time, and held ones opened (S2-02). */
  quietExpired: number;
  quietOpened: number;
};

type TimedWorkRow = {
  deadline_passed: number;
  expired: number;
  expire_refused: number;
  stale: string[];
  approaching: string[];
  /** The circles that may be due a cadence nudge; whether one is owed is the domain's. */
  cadence: string[];
  // Absent from a database that predates 0026 — a deploy lands the function
  // and the migration in either order.
  quiet_expired?: number;
  held?: HeldAsk[];
};

export async function timedWork(
  service: Db,
  requestId: string,
  now: Instant,
  deadline: () => boolean,
): Promise<TimedResult> {
  const { data, error } = await service.rpc('dispatch_timed_work', { p_limit: 50 });
  if (error !== null) throw error;
  const row = data as unknown as TimedWorkRow;

  const result: TimedResult = {
    deadlinesClosed: row.deadline_passed,
    expired: row.expired,
    expireRefused: row.expire_refused,
    recalculated: 0,
    recalculateFailed: 0,
    remindersQueued: 0,
    cadencePrompted: 0,
    nudgesQueued: 0,
    quietExpired: row.quiet_expired ?? 0,
    quietOpened: 0,
  };

  // Held quiet asks whose circle is free again (ADR 0035), first: an ask that
  // opens here is a plan the reminders below may already need to know about.
  result.quietOpened = await openHeldAsks(service, row.held ?? [], now, requestId, deadline);

  for (const planId of row.stale) {
    if (deadline()) return result;
    try {
      await recalculate(service, planId, requestId);
      result.recalculated += 1;
    } catch (thrown) {
      result.recalculateFailed += 1;
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'recalculate_failed',
        reason: classify(thrown),
      });
    }
  }

  // "At most one deadline reminder per member per plan, only to non-responders,
  // 24 h before" (spec §5.8). Who that is belongs to `recipientsFor`, which
  // reads the answers and `alreadySent`; this only says which plans are close
  // enough to ask about. The occurrence is `once` per revision and the
  // cross-revision half is the audience rule, not the key — an edit bumps the
  // revision, and the key alone would re-remind everybody.
  const organiserContacts = new Map<string, string | null>();
  for (const planId of row.approaching) {
    if (deadline()) return result;
    const context = await loadContext(service, planId);
    if (context === null) continue;
    // The SQL names every plan within a day of its deadline; a tonight plan's
    // reminder waits until twenty minutes before (S2-06, `deadlineReminderDue`).
    const plan = context.eligibility.plan;
    if (plan === undefined || !deadlineReminderDue(plan, now)) continue;
    const rows = await jobRowsFor(
      service,
      context,
      { kind: 'deadline_approaching', occurrence: ONCE, desiredAt: now },
      organiserContacts,
      requestId,
    );
    if (rows.length === 0) continue;
    const { data: written, error: failure } = await service.rpc('dispatch_enqueue', {
      p_jobs: rows,
    });
    if (failure !== null) throw failure;
    result.remindersQueued += (written as number | null) ?? 0;
  }

  // Last, and after the plans: a nudge is the least urgent thing a clock
  // creates, and a circle not reached this minute is reached the next.
  if (deadline()) return result;
  const cadence = await cadenceWork(service, row.cadence ?? [], requestId, now, deadline);
  result.cadencePrompted = cadence.prompted;
  result.nudgesQueued = cadence.nudgesQueued;

  return result;
}
