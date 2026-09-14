import type { CandidateSummary } from '@circles/contracts';
import {
  generateCandidates,
  type CandidateSet,
  type EngineInput,
  type MemberResponse,
  type ResponseStatus,
  type UserId,
} from '@circles/domain';

import type { Db } from './db.ts';
import { log } from './logging.ts';
import { fromInstant, now, toInstant, toLocalDate, toZone } from './moment.ts';
import { Refusal } from './problem.ts';

/**
 * Running the engine and storing what it found.
 *
 * One module rather than one endpoint, because it happens two ways. An answer
 * recalculates **inline** in the same request (architecture §9.1), which is what
 * makes the candidates appear the moment the last person replies rather than up
 * to a minute later; and `recalculate-candidates` runs the same thing for the
 * cases no member's request covers. Two entry points to one piece of work, and
 * the work is here so they cannot drift.
 *
 * Three steps and a compare-and-set:
 *
 * 1. `public.engine_input` reads the plan, the roster and the answers in one
 *    statement, so the engine is given a set of inputs that existed together.
 * 2. `generateCandidates` is `packages/domain`'s and runs unchanged — the same
 *    function the client uses for its preview, which is why a candidate the
 *    screen shows is a candidate the server agrees with.
 * 3. `public.store_candidate_set` writes it only if the plan is still at the
 *    version step 1 read. A result computed without somebody's answer must not
 *    become the set `confirm` locks in.
 *
 * `recalculate` throws on failure, which is right for the endpoint that exists
 * only to do this. `recalculateAfterWriting` does not, which is right for the
 * one where an answer has already been stored (ADR 0018).
 */

type EngineInputRow = {
  plan: {
    id: string;
    circle_id: string;
    state: string;
    revision: number;
    input_version: number;
    time_zone: string;
    window_start: string;
    window_end: string;
    daily_start_local: number;
    daily_end_local: number;
    duration_minutes: number;
    quorum: number;
    required_member_ids: string[];
  };
  active_member_ids: string[];
  responses: { user_id: string; status: string; windows: { start: string; end: string }[] }[];
};

/**
 * §12's budget is "8 members × 14 days × 30-minute starts < 50 ms in Node". Ten
 * times that is not a threshold the engine should ever reach, so reaching it is
 * worth a line: the health summary (S1-20) reads these, and a plan that takes
 * half a second to score is either far bigger than the product allows or a
 * regression in the algorithm.
 */
const SLOW_MS = 500;

export async function recalculate(
  service: Db,
  planId: string,
  requestId: string,
): Promise<CandidateSummary> {
  const { data, error } = await service.rpc('engine_input', { p_plan_id: planId });
  if (error !== null) throw error;
  if (data === null) throw new Refusal('plan_not_found', 'That plan is not there.');

  const input = data as unknown as EngineInputRow;
  const { plan } = input;

  const started = Date.now();
  const set = generateCandidates(engineInputOf(input));
  const engineMs = Date.now() - started;

  if (engineMs >= SLOW_MS) {
    log('warn', {
      fn: 'recalculate',
      request_id: requestId,
      event: 'slow_engine',
      duration_ms: engineMs,
    });
  }

  const { data: stored, error: storeError } = await service.rpc('store_candidate_set', {
    p_plan_id: planId,
    // The version the input was read at, which is what makes this a
    // compare-and-set rather than a write.
    p_input_version: plan.input_version,
    p_revision: plan.revision,
    p_set: serialise(set),
  });
  if (storeError !== null) throw storeError;

  const summary = stored as unknown as CandidateSummary & { stored: boolean };
  return {
    ...(summary.candidate_set_id === undefined || summary.candidate_set_id === null
      ? {}
      : { candidate_set_id: summary.candidate_set_id }),
    state: summary.state,
    eligible: summary.eligible,
    near_misses: summary.near_misses,
    input_version: summary.input_version,
  };
}

/**
 * The recalculation, when the answer that prompted it has already committed.
 *
 * ADR 0018: reporting an error for a request that worked is false, and the
 * retry that follows is refused as a replay of something that succeeded — so the
 * person is told to try again and cannot. What is stale is the *set*, which is
 * the condition `recalculate-candidates` exists to repair, so the endpoint says
 * where the plan stands and lets the failure be a log line rather than the
 * answer.
 *
 * It never throws. If even the summary cannot be read, the answer is that we do
 * not know where the plan stands — which the caller reports by saying nothing
 * about it, rather than by inventing a state or by failing a request that
 * worked. Everything refetches on focus (§9.2), so a client that is told
 * nothing asks again.
 */
export async function recalculateAfterWriting(
  service: Db,
  planId: string,
  requestId: string,
): Promise<CandidateSummary | undefined> {
  try {
    return await recalculate(service, planId, requestId);
  } catch (thrown) {
    log('warn', {
      fn: 'recalculate',
      request_id: requestId,
      event: 'not_recalculated',
      reason: (thrown as { code?: string } | undefined)?.code ?? 'unknown',
    });

    const { data, error } = await service.rpc('plan_candidate_summary', { p_plan_id: planId });
    if (error !== null || data === null) return undefined;
    const summary = data as unknown as CandidateSummary;
    return {
      ...(summary.candidate_set_id === undefined || summary.candidate_set_id === null
        ? {}
        : { candidate_set_id: summary.candidate_set_id }),
      state: summary.state,
      eligible: summary.eligible,
      near_misses: summary.near_misses,
      input_version: summary.input_version,
    };
  }
}

/** The row as the engine's own vocabulary. Nothing is decided here. */
function engineInputOf(row: EngineInputRow): EngineInput {
  const { plan } = row;
  return {
    plan: {
      window: { start: toLocalDate(plan.window_start), end: toLocalDate(plan.window_end) },
      daily: { startMin: plan.daily_start_local, endMin: plan.daily_end_local },
      zone: toZone(plan.time_zone),
      durationMinutes: plan.duration_minutes,
      quorum: plan.quorum,
      requiredMemberIds: plan.required_member_ids as UserId[],
    },
    // Entries in the order the read produced, which `engine_input` sorts by
    // member id — the engine hashes them sorted for the same reason.
    responses: row.responses.map((response): readonly [UserId, MemberResponse] => [
      response.user_id as UserId,
      {
        status: response.status as ResponseStatus,
        windows: response.windows.map((window) => ({
          start: toInstant(window.start),
          end: toInstant(window.end),
        })),
      },
    ]),
    activeMemberIds: row.active_member_ids as UserId[],
    // The engine skips starts in the past, so `now` is an input like any other
    // — and reading it here rather than inside keeps the function deterministic
    // for the property tests that depend on it.
    now: now(),
  };
}

/**
 * The engine's answer as JSON Postgres can read.
 *
 * The only change is the instants: the domain counts milliseconds and the wire
 * carries ISO 8601, and `_shared/moment.ts` is the one place that knows both.
 * Everything else keeps the engine's own names, so the row that comes back out
 * of `candidates` can be read against the type that produced it.
 */
function serialise(set: CandidateSet): Record<string, unknown> {
  return {
    scoringVersion: set.scoringVersion,
    inputHash: set.inputHash,
    stats: {
      startsConsidered: set.stats.startsConsidered,
      eligibleCount: set.stats.eligibleCount,
      respondedCount: set.stats.respondedCount,
      activeMemberCount: set.stats.activeMemberCount,
    },
    eligible: set.eligible.map((candidate) => ({
      start: fromInstant(candidate.start),
      end: fromInstant(candidate.end),
      availableUserIds: [...candidate.availableUserIds],
      explicitCount: candidate.explicitCount,
      flexibleCount: candidate.flexibleCount,
      explanation: candidate.explanation,
    })),
    nearMisses: set.nearMisses.map((miss) => ({
      start: fromInstant(miss.start),
      end: fromInstant(miss.end),
      availableUserIds: [...miss.availableUserIds],
      explicitCount: miss.explicitCount,
      flexibleCount: miss.flexibleCount,
      explanation: miss.explanation,
      reason: miss.reason,
    })),
  };
}
