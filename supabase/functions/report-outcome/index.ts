import { ReportOutcomeRequest, ReportOutcomeResponse } from '@circles/contracts';
import { corroborationOf, type Outcome } from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { jsonHandler } from '../_shared/http.ts';

/**
 * "Did this catch-up happen?", and "I was there" (spec §5.10).
 *
 * Two answers from two different people, and the difference is not cosmetic.
 * The organiser's `outcome` is a statement about the evening, and only
 * `happened` moves the circle's `last_met_at` — `public.report_outcome` owns
 * that, including its idempotency: the morning after a catch-up this is tapped
 * on a phone, and a retry whose first attempt committed must not report a
 * failure for something that worked.
 *
 * A member's `attendance` is a statement about themselves, and it is an
 * ordinary RLS write: `attendance_update_own` lets a person write their own row
 * and nobody else's, and `enforce_attendance_transition` holds the rules — not
 * before the meetup has ended, and never back from an answer about the past to
 * a promise about the future. There is no function for it, deliberately (S1-10):
 * a definer function would be a second authority over a row the policy already
 * governs.
 *
 * What comes back is where the meetup stands as evidence — `reported` is the
 * organiser's word for it, `corroborated` is somebody else saying they were
 * there (§11.1) — computed by the domain from what is stored, so the metric and
 * the screen cannot disagree about what corroboration means.
 */
Deno.serve(
  jsonHandler({
    name: 'report-outcome',
    schema: ReportOutcomeRequest,
    handle: async ({ body, caller, actor }): Promise<ReportOutcomeResponse> => {
      if (body.outcome !== undefined) {
        const { error } = await caller.rpc('report_outcome', {
          p_confirmation_id: body.confirmation_id,
          p_outcome: body.outcome,
          p_note: body.note ?? null,
          p_moved_outside: body.moved_outside ?? null,
        });
        if (error !== null) throw error;
      } else {
        // Two statements, because of what a member is allowed to write:
        // `grant update (status) on public.attendance` and nothing else. A
        // plain upsert assigns every column it was given on conflict —
        // `confirmation_id` and `user_id` included — and Postgres refuses it
        // for want of the grant, which would have made the ordinary case (a row
        // derived when the meetup was confirmed) the failing one.
        //
        // So: insert if it is missing and do nothing if it is not, which needs
        // only INSERT; then set the status, which needs only UPDATE(status).
        // `enforce_attendance_transition` holds the rules either way, and the
        // same status twice is a no-op rather than a fresh answer.
        const { error: inserting } = await caller.from('attendance').upsert(
          {
            confirmation_id: body.confirmation_id,
            user_id: actor.userId,
            status: body.attendance,
          },
          { onConflict: 'confirmation_id,user_id', ignoreDuplicates: true },
        );
        if (inserting !== null) throw inserting;

        const { error } = await caller
          .from('attendance')
          .update({ status: body.attendance })
          .eq('confirmation_id', body.confirmation_id)
          .eq('user_id', actor.userId);
        if (error !== null) throw error;
      }

      return summaryOf(caller, body.confirmation_id);
    },
  }),
);

/**
 * Where the meetup stands, counted by the database rather than by the caller.
 *
 * The obvious version of this reads `attendance` and counts — and it is wrong,
 * silently, in the one direction that matters. `attendance_select_member` shows
 * a **retrospective** answer only to the person who gave it: "nobody is scored
 * and nobody is told who came" (spec §5.10) is a policy, not a copy decision. So
 * an organiser reading the table through their own session sees none of the
 * `was_there` rows that would corroborate their report, and the north-star
 * metric's second number (§11.1) would be a flat zero nobody would notice was
 * zero.
 *
 * `public.confirmation_evidence` does the counting where the rows can be seen,
 * and returns no identity at all — how many, and whether anybody other than the
 * reporter said they were there. The word for that is the domain's.
 */
async function summaryOf(caller: Db, confirmationFor: string): Promise<ReportOutcomeResponse> {
  const { data, error } = await caller.rpc('confirmation_evidence', {
    p_confirmation_id: confirmationFor,
  });
  if (error !== null) throw error;

  const evidence = data as unknown as {
    outcome: Outcome | null;
    was_there: number;
    missed: number;
    someone_else_was_there: boolean;
  };

  return ReportOutcomeResponse.parse({
    // Absent until the organiser has answered: a member's "I was there"
    // corroborates nothing on its own, and saying `reported` would claim an
    // outcome nobody has given.
    ...(evidence.outcome === null
      ? {}
      : { corroboration: corroborationOf(evidence.outcome, evidence.someone_else_was_there) }),
    was_there: evidence.was_there,
    missed: evidence.missed,
  });
}
