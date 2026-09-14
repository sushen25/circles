import { DurationMinutes, RevisePlanRequest, RevisePlanResponse } from '@circles/contracts';
import {
  invalidatedResponses,
  invalidatingChanges,
  isDeadlineAllowed,
  lastPossibleStart,
  type UserId,
} from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { now, toInstant, toLocalDate, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import type { Db } from '../_shared/db.ts';

/** What `public.reask_audience` returns, and what `revise_plan` hands back. */
type AudienceRow = { member_user_id: string; has_responded: boolean };

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
 * A preview asks that function directly. A save does not: `public.revise_plan`
 * runs it under the plan's row lock and returns the answer with the plan, so
 * that the audience reported is the audience the change actually cleared. Read
 * from here, an answer arriving between the two calls was wiped by the revision
 * bump and named in `fresh_ask` — the warning wrong about exactly the person it
 * was most about.
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

      const beforeTiming = {
        window: {
          start: toLocalDate(before.window_start),
          end: toLocalDate(before.window_end),
        },
        daily: { startMin: before.daily_start_local, endMin: before.daily_end_local },
        durationMinutes: DurationMinutes.parse(before.duration_minutes),
        zone: after.zone,
      };

      // Changed, not merely sent. An edit form resubmits every field it shows,
      // so `quorum: 4` on a plan whose quorum is already 4 is a form, not an
      // edit — and putting it in the payload would emit "the plan changed",
      // bump `input_version` and drop a `ready` plan back to `collecting` over
      // nothing. The window has been compared this way since the first round;
      // these two were not compared at all.
      const changedQuorum = body.quorum === before.quorum ? undefined : body.quorum;
      const changedDeadline =
        body.response_deadline !== undefined &&
        toInstant(body.response_deadline) !== toInstant(before.response_deadline)
          ? body.response_deadline
          : undefined;

      // "Never after the last possible start" (spec §5.3), and never already
      // past — ADR 0010's deadline is a promise about when replies close, and a
      // deadline in the past closes them the instant it is saved, leaving a plan
      // that can be neither answered nor recalculated. Judged against the *new*
      // window, because one request may move both. `create-plan` asks the same
      // domain function the same way; a plan could be created only with a valid
      // deadline and then edited to any deadline at all.
      //
      // Only when it is changing: a plan whose deadline has quietly passed is
      // still editable (§5.7 offers "give it one more day"), and refusing the
      // whole request because a resubmitted form carried the old value would
      // make it uneditable at exactly the moment it most needs editing.
      if (changedDeadline !== undefined) {
        if (!isDeadlineAllowed(toInstant(changedDeadline), lastPossibleStart(after), now())) {
          throw new Refusal(
            'deadline_out_of_range',
            'Replies have to close in the future and before the last possible start.',
          );
        }
      }

      // Parsed on the way out, like every DTO here: the domain brands a `UserId`
      // one way and the contract another, and the parse is what makes the two
      // agree rather than a cast asserting that they do.
      const answerFor = (rows: AudienceRow[]): RevisePlanResponse => {
        const cost = invalidatedResponses(
          beforeTiming,
          after,
          rows.map((row) => row.member_user_id as UserId),
          rows.filter((row) => row.has_responded).map((row) => row.member_user_id as UserId),
          // A reopen invalidates everything while changing no timing at all, so
          // the comparison cannot see it: "Thursday is off the table … and a
          // fresh ask" (spec §5.7). Reported as `bumps_revision` alone, it said
          // a new revision was coming and named nobody it would cost — which is
          // the whole warning, missing for the one edit that always costs the
          // most.
          body.reopen,
        );
        return RevisePlanResponse.parse({
          asked_again: [...cost.askedAgain],
          fresh_ask: [...cost.freshAsk],
          invalidating: [...cost.changes],
          bumps_revision: cost.bumpsRevision,
        });
      };

      if (body.preview) {
        const { data: audience, error: audienceError } = await caller.rpc('reask_audience', {
          p_plan_id: body.plan_id,
        });
        if (audienceError !== null) throw audienceError;
        return answerFor((audience ?? []) as AudienceRow[]);
      }

      // Only what actually changed, and `invalidatingChanges` is the authority on
      // that — the same comparison the preview's answer is built from, over the
      // same two timings, so the payload and the warning cannot disagree. A
      // client that re-sends the current window unchanged is not editing
      // anything, and putting it in the payload would make `revise_plan` call it
      // an `edit` and bump a revision, clearing every answer over a no-op.
      const changes = invalidatingChanges(beforeTiming, after);
      const payload: Record<string, unknown> = {};
      if (changes.includes('window') && body.window !== undefined) {
        payload['window_start'] = body.window.start;
        payload['window_end'] = body.window.end;
      }
      if (changes.includes('daily') && body.daily !== undefined) {
        payload['daily_start_local'] = body.daily.startMin;
        payload['daily_end_local'] = body.daily.endMin;
      }
      if (changes.includes('duration') && body.duration_minutes !== undefined) {
        payload['duration_minutes'] = body.duration_minutes;
      }
      if (changedQuorum !== undefined) payload['quorum'] = changedQuorum;
      if (changedDeadline !== undefined) payload['response_deadline'] = changedDeadline;

      // Everything in it is what the plan already says. `revise_plan` would
      // still transition — an `adjust` with an empty payload, an event saying
      // the plan changed, and a revision number that has to be explained to
      // whoever reads the history. Refused with its own reason rather than
      // answered with a shrug, because a client that sent this has a bug in its
      // form and should hear so.
      if (
        Object.keys(payload).length === 0 &&
        body.required_member_ids === undefined &&
        !body.reopen
      ) {
        throw new Refusal('nothing_to_change', 'Nothing in that is different from the plan.');
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

      // The audience as it was inside that transaction, not as it was one round
      // trip ago.
      const result = data as { plan: { revision: number }; audience: AudienceRow[] };
      return { ...answerFor(result.audience ?? []), revision: result.plan.revision };
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
  quorum: number;
  response_deadline: string;
}> {
  const { data, error } = await caller
    .from('plans')
    .select(
      'window_start, window_end, daily_start_local, daily_end_local, duration_minutes, time_zone, quorum, response_deadline',
    )
    .eq('id', planId)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) throw new Refusal('plan_not_found', 'That plan is not there.');
  return data;
}
