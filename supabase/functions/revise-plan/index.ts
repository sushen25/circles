import { DurationMinutes, RevisePlanRequest, RevisePlanResponse } from '@circles/contracts';
import { invalidatedResponses, type UserId } from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { toLocalDate, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import type { Db } from '../_shared/db.ts';

/**
 * Editing a plan, and the warning that has to come first.
 *
 * Spec §5.3: an edit that invalidates responses "shows, **before saving**,
 * exactly who will be asked again". So this endpoint answers that question
 * twice — once with `preview: true`, changing nothing, and once for real — and
 * the answer has the same shape both times, because it is computed the same way
 * both times. A preview that took a different path would be a warning about a
 * different edit.
 *
 * The two lists come from `invalidatedResponses` in `packages/domain`, from
 * facts only the server can see: `public.reask_audience` returns who the plan
 * was addressed to and which of them have answered, because a member may read
 * only their *own* response and that is deliberate.
 *
 * `reopen` is the same endpoint because it is the same decision — "this time
 * does not work, let us look again" (§5.7) — but a different transition, with
 * its own event and its own effect on the confirmation.
 */
Deno.serve(
  jsonHandler({
    name: 'revise-plan',
    schema: RevisePlanRequest,
    handle: async ({ body, caller }): Promise<RevisePlanResponse> => {
      const before = await readPlan(caller, body.plan_id);

      const after = {
        window: {
          start: toLocalDate(body.window?.start ?? before.window_start),
          end: toLocalDate(body.window?.end ?? before.window_end),
        },
        daily: {
          startMin: body.daily?.startMin ?? before.daily_start_local,
          endMin: body.daily?.endMin ?? before.daily_end_local,
        },
        // Parsed rather than asserted: `plans_duration` allows only the four
        // (spec §5.3), so a row carrying anything else is a database that has
        // stopped being true, and saying so beats carrying the number onward.
        durationMinutes: DurationMinutes.parse(body.duration_minutes ?? before.duration_minutes),
        zone: toZone(before.time_zone),
      };

      const { data: audience, error: audienceError } = await caller.rpc('reask_audience', {
        p_plan_id: body.plan_id,
      });
      if (audienceError !== null) throw audienceError;

      const rows = (audience ?? []) as { member_user_id: string; has_responded: boolean }[];
      const members = rows.map((row) => row.member_user_id as UserId);
      const responded = rows
        .filter((row) => row.has_responded)
        .map((row) => row.member_user_id as UserId);

      const cost = invalidatedResponses(
        {
          window: {
            start: toLocalDate(before.window_start),
            end: toLocalDate(before.window_end),
          },
          daily: { startMin: before.daily_start_local, endMin: before.daily_end_local },
          durationMinutes: DurationMinutes.parse(before.duration_minutes),
          zone: after.zone,
        },
        after,
        members,
        responded,
      );

      // Parsed on the way out, like every DTO here: the domain brands a `UserId`
      // one way and the contract another, and the parse is what makes the two
      // agree rather than a cast asserting that they do.
      const answer = RevisePlanResponse.parse({
        asked_again: [...cost.askedAgain],
        fresh_ask: [...cost.freshAsk],
        invalidating: [...cost.changes],
        bumps_revision: cost.bumpsRevision || body.reopen,
      });

      if (body.preview) return answer;

      // Only what actually changed, and `cost.changes` is the authority on that —
      // the same answer the preview just gave. A client that re-sends the current
      // window unchanged is not editing anything, and putting it in the payload
      // would make `revise_plan` call it an `edit` and bump a revision, clearing
      // every answer over a no-op.
      const payload: Record<string, unknown> = {};
      if (cost.changes.includes('window') && body.window !== undefined) {
        payload['window_start'] = body.window.start;
        payload['window_end'] = body.window.end;
      }
      if (cost.changes.includes('daily') && body.daily !== undefined) {
        payload['daily_start_local'] = body.daily.startMin;
        payload['daily_end_local'] = body.daily.endMin;
      }
      if (cost.changes.includes('duration') && body.duration_minutes !== undefined) {
        payload['duration_minutes'] = body.duration_minutes;
      }
      if (body.quorum !== undefined) payload['quorum'] = body.quorum;
      if (body.response_deadline !== undefined) {
        payload['response_deadline'] = body.response_deadline;
      }

      const { data, error } = await caller.rpc('revise_plan', {
        p_plan_id: body.plan_id,
        p_reopen: body.reopen,
        p_payload: payload,
        // `null` and `[]` mean different things — leave them alone, and nobody is
        // required — so the absent case is passed as null rather than collapsed.
        p_required_member_ids: body.required_member_ids ?? null,
      });
      if (error !== null) throw error;

      const plan = (Array.isArray(data) ? data[0] : data) as { revision: number };
      return { ...answer, revision: plan.revision };
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
  if (data === null) throw new Refusal('plan_not_found', 'That plan is not there.');
  return data;
}
