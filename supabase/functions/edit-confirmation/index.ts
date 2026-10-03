import { EditConfirmationRequest, EditConfirmationResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, toInstant } from '../_shared/moment.ts';

/**
 * The organiser edits a locked-in plan: its time, its place and its note
 * (ADR 0050).
 *
 * Thin, like `confirm-meetup`, because everything that decides anything is one
 * transaction below: `public.edit_confirmation` hands the plan to
 * `planning.transition_plan`, which checks that the caller is the organiser and
 * still a member and, for a new time, that it is a valid one. A **move**
 * supersedes the active confirmation and writes a new one in the same revision,
 * derives who is going again and emits `confirmation.meetup_moved`; a **place or
 * note edit** updates the active confirmation in place and emits nothing, so
 * nobody is emailed. Neither asks anybody to answer again.
 *
 * The place and note are said whole. `null` and a missing field both clear one,
 * which is what a screen showing the current values and an empty field means.
 */
Deno.serve(
  jsonHandler({
    name: 'edit-confirmation',
    schema: EditConfirmationRequest,
    handle: async ({ body, caller }): Promise<EditConfirmationResponse> => {
      const { data, error } = await caller.rpc('edit_confirmation', {
        p_plan_id: body.plan_id,
        p_starts_at: body.starts_at ?? null,
        p_ends_at: body.ends_at ?? null,
        // Checked under the plan's lock for a move: "are these still the names
        // you were looking at?" can only be answered truthfully there.
        p_expected_input_version: body.expected_input_version ?? null,
        p_place_name: body.place_name ?? null,
        p_place_url: body.place_url ?? null,
        p_note: body.note ?? null,
      });
      if (error !== null) throw error;

      const confirmation = (Array.isArray(data) ? data[0] : data) as {
        id: string;
        starts_at: string;
        ends_at: string;
        available_user_ids: string[];
      };

      // Who is going is the attendance of this confirmation, not the frozen
      // set of who could make it: after an own time they are the same people,
      // and after anyone says otherwise the confirmed screen reads attendance.
      const { data: attendance, error: attendanceError } = await caller
        .from('attendance')
        .select('user_id')
        .eq('confirmation_id', confirmation.id)
        .eq('status', 'going');
      if (attendanceError !== null) throw attendanceError;

      return EditConfirmationResponse.parse({
        confirmation_id: confirmation.id,
        starts_at: fromInstant(toInstant(confirmation.starts_at)),
        ends_at: fromInstant(toInstant(confirmation.ends_at)),
        going: (attendance ?? []).map((row) => row.user_id),
      });
    },
  }),
);
