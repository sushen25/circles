import { ReportOutcomeRequest, ReportOutcomeResponse } from '@circles/contracts';
import {
  circleId,
  confirmationId,
  corroboration,
  userId,
  type Attendance,
  type AttendanceStatus,
  type Outcome,
  type OutcomeReport,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';
import { jsonHandler } from '../_shared/http.ts';
import { toInstant } from '../_shared/moment.ts';

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
        // Upsert, because the row may not exist: attendance is derived for
        // every participant when the meetup is confirmed, but somebody who
        // joined the plan later, or whose row was never written, still gets to
        // say they were there.
        const { error } = await caller
          .from('attendance')
          .upsert(
            {
              confirmation_id: body.confirmation_id,
              user_id: actor.userId,
              status: body.attendance,
            },
            { onConflict: 'confirmation_id,user_id' },
          )
          .select('status')
          .maybeSingle();
        if (error !== null) throw error;
      }

      return summaryOf(caller, body.confirmation_id);
    },
  }),
);

/**
 * Where the meetup stands, read after the write rather than assumed from it.
 *
 * Both callers need the same answer and neither can compute it alone: a
 * member's "I was there" can be the thing that corroborates an outcome reported
 * days ago, and an organiser's `happened` can be corroborated by an answer that
 * was already there. So it is one read of what is stored, through the caller's
 * own client — `attendance_select_member` shows a member the retrospective
 * answers of others, which is exactly the counting this does.
 */
async function summaryOf(caller: Db, confirmationFor: string): Promise<ReportOutcomeResponse> {
  const { data: rows, error } = await caller
    .from('attendance')
    .select('user_id, status, updated_at')
    .eq('confirmation_id', confirmationFor);
  if (error !== null) throw error;

  const id = confirmationId(confirmationFor);
  const attendances = (rows ?? []).map((row): Attendance => ({
    confirmationId: id,
    userId: userId(row.user_id),
    status: row.status as AttendanceStatus,
    updatedAt: toInstant(row.updated_at),
  }));

  const { data: report, error: reportError } = await caller
    .from('outcome_reports')
    // The circle comes along because `OutcomeReport` carries it: a report is
    // about a circle's evening, and the metric counts per circle (§11.1).
    .select(
      'confirmation_id, reported_by, outcome, reported_at, meetup_confirmations(plans(circle_id))',
    )
    .eq('confirmation_id', confirmationFor)
    // At most one: only the organiser may report, and `(confirmation_id,
    // reported_by)` is unique. Limited anyway, because `maybeSingle` treats a
    // second row as an error and a 500 is the wrong answer to "somebody else
    // also reported".
    .order('reported_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (reportError !== null) throw reportError;

  return ReportOutcomeResponse.parse({
    // Absent until the organiser has answered: a member's "I was there"
    // corroborates nothing on its own, and saying `reported` would claim an
    // outcome nobody has given.
    ...(report === null
      ? {}
      : {
          corroboration: corroboration(
            {
              confirmationId: id,
              circleId: circleId(
                (report as unknown as { meetup_confirmations: { plans: { circle_id: string } } })
                  .meetup_confirmations.plans.circle_id,
              ),
              reportedBy: userId(report.reported_by),
              outcome: report.outcome as Outcome,
              reportedAt: toInstant(report.reported_at),
            } satisfies OutcomeReport,
            attendances,
          ),
        }),
    was_there: attendances.filter((a) => a.status === 'was_there').length,
    missed: attendances.filter((a) => a.status === 'missed').length,
  });
}
