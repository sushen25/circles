import { ConfirmMeetupRequest, ConfirmMeetupResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, toInstant } from '../_shared/moment.ts';

/**
 * The organiser locks a time in (spec §5.7).
 *
 * Thin, because everything that decides anything is one transaction below:
 * `public.confirm_meetup` hands the plan to `planning.transition_plan`, which
 * checks that the caller is the organiser and still a member, that the candidate
 * is eligible against the *current* set, and that its start has not passed —
 * then writes the frozen confirmation, derives everybody's attendance and emits
 * `confirmation.meetup_confirmed`, all under the plan's row lock.
 *
 * "Frozen" is the point of doing it there rather than here (architecture §6.2):
 * who could make it is copied into the confirmation as it was at that instant,
 * and a reply arriving a second later does not change who is on the card. Two
 * organisers tapping at once are serialised by the same lock, and the second
 * finds the plan is no longer `ready`.
 *
 * The one thing this endpoint adds is the difference between "your screen is out
 * of date" (`stale_candidates`, refetch) and "that is not one of the options"
 * (`needs_candidate`) — which the SQL raises separately so that a client can
 * tell an organiser something true. "Out of date" is measured against the
 * version the organiser was *shown*, which they send: by the time a tap
 * arrives, an answer may have produced a whole new current set.
 */
Deno.serve(
  jsonHandler({
    name: 'confirm-meetup',
    schema: ConfirmMeetupRequest,
    handle: async ({ body, caller }): Promise<ConfirmMeetupResponse> => {
      const { data, error } = await caller.rpc('confirm_meetup', {
        p_plan_id: body.plan_id,
        p_candidate_id: body.candidate_id,
        // Checked under the plan's lock, where "has anything moved?" can still
        // be answered truthfully.
        p_expected_version: body.expected_version,
        p_place_name: body.place_name ?? null,
        p_place_url: body.place_url ?? null,
        p_note: body.note ?? null,
        p_chased_answer: body.chased_answer,
      });
      if (error !== null) throw error;

      const confirmation = (Array.isArray(data) ? data[0] : data) as {
        id: string;
        starts_at: string;
        ends_at: string;
        available_user_ids: string[];
      };

      // The frozen set, as it was written. Not recomputed here: "who could make
      // it" is a fact about the moment it was locked in, and asking again would
      // be a different question with a different answer.
      //
      // Parsed rather than cast, and the instants go through `moment.ts` on the
      // way — Postgres renders an offset its own way, and the contract asks for
      // ISO 8601. A cast would be a claim that they agree.
      return ConfirmMeetupResponse.parse({
        confirmation_id: confirmation.id,
        starts_at: fromInstant(toInstant(confirmation.starts_at)),
        ends_at: fromInstant(toInstant(confirmation.ends_at)),
        going: confirmation.available_user_ids,
      });
    },
  }),
);
