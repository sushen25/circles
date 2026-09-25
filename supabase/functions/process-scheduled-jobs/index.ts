import { z } from 'zod';

import { instant } from '@circles/domain';

import { internalHandler } from '../_shared/internal.ts';
import { log } from '../_shared/logging.ts';
import { type OutboxEvent, drain } from './drain.ts';
import { reportHealth } from './health.ts';
import { type DueJob, send } from './send.ts';
import { timedWork } from './timed.ts';

/**
 * The one background worker (ADR 0003, architecture §9.3).
 *
 * `pg_cron` calls it every minute through `pg_net`, under the bearer the
 * runbook sets as `CRON_SECRET`; `internalHandler` is what refuses everything
 * else, including — deliberately — every call made while that secret is unset.
 *
 * Four phases, in this order and for this reason:
 *
 * 1. **Drain the outbox.** Events become notification jobs. First, because
 *    everything after it may act on what it wrote.
 * 2. **Time-based work.** Deadlines close, plans expire, stale candidate sets
 *    are recomputed, reminders are queued. Second, because a deadline passing
 *    writes an event that the *next* tick will drain — a minute's delay on a
 *    message about a day-long deadline, in exchange for one place where events
 *    become messages.
 * 3. **Send what is due**, including anything phase 1 queued for now.
 * 4. **The health summary**, once a day, last, so that its counts describe a
 *    run that has already happened.
 *
 * **The lease is the concurrency control.** `public.dispatch_begin` takes it
 * for ninety seconds and a run that cannot take it does nothing at all — not a
 * shorter run, nothing — because two dispatchers drawing from one queue is
 * exactly the shape that sends two of everything.
 *
 * **The budget is 50 seconds**, and the lease is ninety. Every phase is handed
 * a `deadline()` and stops between items rather than in the middle of one;
 * work left over is not lost, because the queues are in the database and the
 * next tick is a minute away. The lease is longer than the budget rather than
 * equal to it so that a run which overran — a provider that accepts the
 * connection and says nothing until the send times out — still holds it while
 * it finishes. A lease that lapses under a running dispatcher is the one way
 * two of them can draw the same job (review round 2).
 */

const BUDGET_MS = 50_000;

/**
 * How much of the budget the last send may still need.
 *
 * `deadline()` is checked *between* items, so a send that starts at 49.9 s and
 * then waits out `_shared/email/resend.ts`'s twenty-second timeout ends the run
 * at seventy. The lease is taken for ninety seconds precisely so that such a
 * run still holds it — but a phase that knows how long one of its items can
 * take should stop before it, not rely on the margin. So the send phase stops
 * *starting* work with a send's worth of budget left (review round 2).
 */
const SEND_RESERVE_MS = 25_000;

/** No body. The work is found in the database, never named by the caller. */
const ProcessScheduledJobsRequest = z.object({}).loose();

type RunSummary = Record<string, number>;

type RunReport = { ran: boolean; counts?: RunSummary };

Deno.serve(
  internalHandler({
    name: 'process-scheduled-jobs',
    schema: ProcessScheduledJobsRequest,
    handle: async ({ service, requestId }): Promise<RunReport> => {
      const started = Date.now();
      const deadline = (): boolean => Date.now() - started > BUDGET_MS;
      const now = instant(started);

      const { data: acquired, error: leaseError } = await service.rpc('dispatch_begin', {
        p_holder: requestId,
      });
      if (leaseError !== null) throw leaseError;
      if (acquired !== true) {
        log('info', {
          fn: 'process-scheduled-jobs',
          request_id: requestId,
          event: 'lease_held',
        });
        return { ran: false };
      }

      const counts: RunSummary = {};
      try {
        const { data: events, error: eventsError } = await service.rpc('dispatch_claim_events', {
          p_limit: 200,
        });
        if (eventsError !== null) throw eventsError;
        const drained = await drain(
          service,
          (events ?? []) as unknown as OutboxEvent[],
          requestId,
          now,
          deadline,
        );
        counts['events'] = drained.events;
        counts['jobs_created'] = drained.jobs;
        counts['event_failures'] = drained.failures;
        log('info', {
          fn: 'process-scheduled-jobs',
          request_id: requestId,
          event: 'drained',
          counts: { ...counts },
        });

        if (!deadline()) {
          const timed = await timedWork(service, requestId, now, deadline);
          counts['deadlines_closed'] = timed.deadlinesClosed;
          counts['expired'] = timed.expired;
          counts['expire_refused'] = timed.expireRefused;
          counts['recalculated'] = timed.recalculated;
          counts['recalculate_failed'] = timed.recalculateFailed;
          counts['reminders_queued'] = timed.remindersQueued;
          counts['cadence_prompted'] = timed.cadencePrompted;
          counts['nudges_queued'] = timed.nudgesQueued;
          counts['quiet_expired'] = timed.quietExpired;
          counts['quiet_opened'] = timed.quietOpened;
        }

        if (!deadline()) {
          const { data: due, error: dueError } = await service.rpc('dispatch_claim_due', {
            p_limit: 50,
          });
          if (dueError !== null) throw dueError;
          const sent = await send(
            service,
            (due ?? []) as unknown as DueJob[],
            requestId,
            () => Date.now() - started > BUDGET_MS - SEND_RESERVE_MS,
          );
          counts['sent'] = sent.sent;
          counts['skipped'] = sent.skipped;
          counts['failed'] = sent.failed;
          counts['retried'] = sent.retried;
        }

        if (!deadline()) {
          counts['health_reported'] = (await reportHealth(service, requestId)) ? 1 : 0;
        }
      } finally {
        // Always, and before the response: a run that kept the lease after it
        // stopped would silence the next ninety seconds of ticks for
        // nothing. `release_lease` is the holder's alone, so this cannot take
        // away a lease that has already lapsed into somebody else's hands.
        const { error: releaseError } = await service.rpc('dispatch_end', {
          p_holder: requestId,
        });
        if (releaseError !== null) {
          log('error', {
            fn: 'process-scheduled-jobs',
            request_id: requestId,
            event: 'lease_release_failed',
          });
        }
      }

      log('info', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'run_finished',
        duration_ms: Date.now() - started,
        counts,
      });
      return { ran: true, counts };
    },
  }),
);
