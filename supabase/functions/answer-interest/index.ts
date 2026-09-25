import { AnswerInterestRequest, type AnswerInterestResponse } from '@circles/contracts';
import { defaultDeadline, isQuietPreset, lastPossibleStart } from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, now, toLocalDate, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import { enforce } from '../_shared/rate.ts';

/**
 * **I'm keen** / **Not this time** on a quiet ask (spec §5.4.2, architecture
 * §9.1).
 *
 * The answer, the count and the crossing are `public.record_interest`'s, in one
 * transaction under the plan's row lock: however many answers arrive together,
 * exactly one opens the ask (SUS-24's note). This function does the one thing
 * the database should not, which is the domain's arithmetic — the response
 * deadline the ask gets *if* this answer opens it, `defaultDeadline` for its
 * window as of now (`onThreshold`). It is worked out before the answer is known
 * to be the one, because the deadline depends on the window and the clock and
 * on nobody's answer.
 *
 * **The response has no count in it** and neither does anything logged:
 * `threshold_reached` is false for "one more needed", "ten more needed" and
 * "held beside an open plan" alike (`InterestReceipt`). The wrapper logs the
 * function, the status and a refusal's reason, never the caller.
 */
Deno.serve(
  jsonHandler({
    name: 'answer-interest',
    schema: AnswerInterestRequest,
    guard: async ({ actor, service }) => {
      // Generous: a person changes their mind a handful of times at most.
      // This is for a script, not for them.
      await enforce(service, [
        { scope: 'answer_interest', key: actor.userId, max: 60, window: '1 hour' },
      ]);
    },
    handle: async ({ body, actor, caller, service }): Promise<AnswerInterestResponse> => {
      // Through the caller's own client, so RLS answers "may this person see
      // this plan?" — and then again inside `record_interest`, under the lock,
      // which is the answer that counts.
      const { data: plan, error: planError } = await caller
        .from('plans')
        .select(
          'mode, quiet_preset, window_start, window_end, daily_start_local, daily_end_local, duration_minutes, time_zone',
        )
        .eq('id', body.plan_id)
        .maybeSingle();
      if (planError !== null) throw planError;
      if (plan === null) throw new Refusal('plan_not_found', 'That plan is not there.');
      if (
        plan.mode !== 'quiet' ||
        plan.quiet_preset === null ||
        !isQuietPreset(plan.quiet_preset)
      ) {
        throw new Refusal('not_quiet', 'That plan is not a quiet ask.');
      }

      const at = now();
      const latestStart = lastPossibleStart({
        window: { start: toLocalDate(plan.window_start), end: toLocalDate(plan.window_end) },
        daily: { startMin: plan.daily_start_local, endMin: plan.daily_end_local },
        durationMinutes: plan.duration_minutes,
        zone: toZone(plan.time_zone),
      });
      const deadline = defaultDeadline(plan.quiet_preset, at, latestStart);

      const { data, error } = await service.rpc('record_interest', {
        p_plan_id: body.plan_id,
        p_actor: actor.userId,
        p_interested: body.interested,
        // Undefined only once the last possible start has gone, and an ask
        // stops asking before then; null opens nothing.
        p_deadline_if_opened: deadline === undefined ? null : fromInstant(deadline),
      });
      if (error !== null) throw error;

      return {
        threshold_reached:
          (data as { threshold_reached?: unknown } | null)?.threshold_reached === true,
      };
    },
  }),
);
