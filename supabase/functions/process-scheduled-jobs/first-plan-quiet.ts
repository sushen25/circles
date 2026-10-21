import { type Instant, ONCE, firstPlanQuietLetterDue, instant } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { log } from '../_shared/logging.ts';
import { loadContext } from './context.ts';
import { classify, jobRowsFor } from './drain.ts';

/**
 * The founder's "want a hand?" letter (SUS-240, ADR 0085): one letter to the
 * organiser of a circle's first plan, 48 hours in and still unanswered.
 *
 * `public.dispatch_first_plan_quiet_candidates` names the plans that may be
 * owed it, as a superset: first named plans, still asking, 48 hours old, in a
 * circle never sent it. Whether it is owed now is the domain's
 * (`firstPlanQuietLetterDue`); who it goes to, on what, and when (the
 * organiser's confirmed address, under quiet hours, only while organiser
 * letters are on) is `recipientsFor` and `scheduleFor`, through the same
 * `jobRowsFor` the outbox drain uses. `public.dispatch_first_plan_quiet`
 * records the circle as decided and writes the job in one transaction, so a
 * second pass, a second plan or a second dispatcher writes nothing.
 *
 * A pass that fails does not stop the others: this is the least urgent thing a
 * clock creates, and a plan not reached this minute is reached the next.
 */

export type FirstPlanQuietResult = { considered: number; decided: number; queued: number };

type Candidate = {
  plan_id: string;
  created_ms: number;
};

export async function firstPlanQuietWork(
  service: Db,
  requestId: string,
  now: Instant,
  deadline: () => boolean,
): Promise<FirstPlanQuietResult> {
  const result: FirstPlanQuietResult = { considered: 0, decided: 0, queued: 0 };

  const { data, error } = await service.rpc('dispatch_first_plan_quiet_candidates', {
    p_limit: 50,
  });
  if (error !== null) {
    // A database that predates 0073: a deploy lands the function and the
    // migration in either order, and this must not stop the rest of the run.
    log('warn', {
      fn: 'process-scheduled-jobs',
      request_id: requestId,
      event: 'first_plan_quiet_unavailable',
      reason: classify(error),
    });
    return result;
  }

  const organiserContacts = new Map<string, string | null>();
  for (const candidate of (data ?? []) as unknown as Candidate[]) {
    if (deadline()) return result;
    result.considered += 1;
    try {
      const context = await loadContext(service, candidate.plan_id);
      if (context === null) continue;
      const plan = context.eligibility.plan;
      if (plan === undefined) continue;

      const due = firstPlanQuietLetterDue({
        createdAt: instant(candidate.created_ms),
        now,
        // The sweep named only plans nobody else had answered on any revision;
        // asked again here, over the plan as it is now, for an answer since.
        othersAnswered: context.eligibility.responses.filter(
          (r) => r.userId !== plan.organiserUserId,
        ).length,
        // The SQL names only a circle's first named plan, still asking.
        isFirstPlan: true,
        stillAsking: plan.state === 'collecting' || plan.state === 'ready',
        alreadySent: false,
      });
      if (!due) continue;

      const rows = await jobRowsFor(
        service,
        context,
        { kind: 'first_plan_quiet', occurrence: ONCE, desiredAt: now },
        organiserContacts,
        requestId,
      );
      const { data: written, error: failure } = await service.rpc('dispatch_first_plan_quiet', {
        p_plan_id: candidate.plan_id,
        p_jobs: rows,
      });
      if (failure !== null) throw failure;
      // Null: another run decided this circle first, or somebody answered
      // between the read and the write. Nothing of ours was written.
      if (written === null) continue;
      result.decided += 1;
      result.queued += written as number;
    } catch (thrown) {
      log('warn', {
        fn: 'process-scheduled-jobs',
        request_id: requestId,
        event: 'first_plan_quiet_failed',
        reason: classify(thrown),
      });
    }
  }

  return result;
}
