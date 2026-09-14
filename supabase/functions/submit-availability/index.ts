import {
  DurationMinutes,
  SubmitAvailabilityRequest,
  type SubmitAvailabilityResponse,
} from '@circles/contracts';
import { normaliseWindows, isErr } from '@circles/domain';

import { recalculate } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, toInstant, toLocalDate, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import { enforce } from '../_shared/rate.ts';
import type { Db } from '../_shared/db.ts';

/**
 * One member's answer, and the recalculation it triggers (spec §5.5).
 *
 * Two things happen and they are not the same kind of thing. The answer is
 * written by `public.replace_response`, which is the only write path there is
 * (ADR 0013) and which holds every rule about who may answer what and when: the
 * revision has to be the one being asked, the person has to have been asked, and
 * replies have to be open. None of that is re-decided here.
 *
 * Then the engine runs **in the same request**, because the alternative is a
 * screen that says "thanks" and shows nothing until a scheduled job catches up.
 * Architecture §9.1 puts it here for that reason, and the compare-and-set in
 * `store_candidate_set` is what makes it safe to do inline and concurrently: two
 * answers landing together produce two recalculations, and the one computed
 * without the other's answer is discarded rather than stored.
 *
 * The windows are normalised by `packages/domain` before they are sent —
 * aligned to the plan's local half hours, clipped to its daily bands, merged and
 * sorted. The database enforces that shape too (`enforce_window_shape`), and the
 * normalisation is what means a person's finger on a touch screen produces an
 * answer rather than a refusal.
 */
Deno.serve(
  jsonHandler({
    name: 'submit-availability',
    schema: SubmitAvailabilityRequest,
    guard: async ({ actor, service }) => {
      // The most expensive endpoint per request in the product: every call runs
      // the engine. Editing an answer several times while painting is ordinary
      // — spec §5.5 expects it, and drafts resubmit after going offline — so the
      // limit is set where a person cannot reach it and a script can. Not
      // authorisation: who may answer is `replace_response`'s, and skipping this
      // reaches none of it.
      await enforce(service, [
        { scope: 'submit_availability', key: actor.userId, max: 120, window: '1 hour' },
      ]);
    },
    handle: async ({ body, caller, service }): Promise<SubmitAvailabilityResponse> => {
      const plan = await readPlan(caller, body.plan_id);

      // Normalised against the plan as the person was shown it. A window on a
      // date the plan never mentions is the caller and the plan disagreeing
      // about what was asked, and it is refused rather than quietly dropped —
      // an answer that lost half of what somebody painted is worse than one
      // they are asked to give again.
      const normalised = normaliseWindows(
        body.windows.map((window) => ({
          start: toInstant(window.start),
          end: toInstant(window.end),
        })),
        {
          window: { start: toLocalDate(plan.window_start), end: toLocalDate(plan.window_end) },
          daily: { startMin: plan.daily_start_local, endMin: plan.daily_end_local },
          // Parsed rather than asserted: `plans_duration` allows only the four
          // (spec §5.3), so a row carrying anything else is a database that has
          // stopped being true.
          durationMinutes: DurationMinutes.parse(plan.duration_minutes),
          zone: toZone(plan.time_zone),
        },
      );
      if (isErr(normalised)) {
        // The domain's own error names, unchanged, because each is a different
        // thing to say to somebody: one window is impossible, the other is
        // about dates this plan is not asking about.
        throw new Refusal(
          normalised.error.code,
          normalised.error.code === 'not_a_window'
            ? 'That is not a time span.'
            : 'That time is outside the dates being asked about.',
        );
      }

      // Aligning can leave a `windows` answer with nothing in it — every span
      // was a stray tap shorter than a half hour. `replace_response` refuses
      // that, and saying so here gives it the reason the schema would have.
      if (body.status === 'windows' && normalised.value.length === 0) {
        throw new Refusal(
          'windows_do_not_match_status',
          'Those were too short to count. Paint at least half an hour.',
        );
      }

      const { data, error } = await caller.rpc('replace_response', {
        p_plan_id: body.plan_id,
        p_revision: body.revision,
        p_status: body.status,
        p_windows: normalised.value.map((window) => ({
          start: fromInstant(window.start),
          end: fromInstant(window.end),
        })),
        p_used_calendar_overlay: body.used_calendar_overlay,
      });
      if (error !== null) throw error;

      const response = (Array.isArray(data) ? data[0] : data) as {
        id: string;
        revision: number;
      };

      // Through the service client, because the engine reads every member's
      // answer and the person who just replied may read only their own
      // (`plan_responses_select_own`). What comes back is the combined result,
      // which is the only form of it anybody sees (spec §5.5).
      const candidates = await recalculate(service, body.plan_id);

      return {
        response_id: response.id as SubmitAvailabilityResponse['response_id'],
        revision: response.revision,
        candidates,
      };
    },
  }),
);

async function readPlan(
  caller: Db,
  planId: string,
): Promise<{
  window_start: string;
  window_end: string;
  daily_start_local: number;
  daily_end_local: number;
  duration_minutes: number;
  time_zone: string;
}> {
  const { data, error } = await caller
    .from('plans')
    .select(
      'window_start, window_end, daily_start_local, daily_end_local, duration_minutes, time_zone',
    )
    .eq('id', planId)
    .maybeSingle();
  if (error !== null) throw error;
  // RLS answers "may this person see this plan?", so a member of another circle
  // and a plan that does not exist give the same answer — which is the same
  // thing `replace_response` says, and for the same reason.
  if (data === null) throw new Refusal('plan_not_found', 'That plan is not there.');
  return data;
}
