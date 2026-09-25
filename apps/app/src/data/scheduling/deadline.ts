import {
  ExtendDeadlineRequest,
  ExtendDeadlineResponse,
  HandOffOrganiserRequest,
  HandOffOrganiserResponse,
} from '@circles/contracts';

import { authClient } from '../auth/client';
import { invokeFunction, newIdempotencyKey } from '../functions';

/**
 * The two ways out of "replies closed with no decision" that are not locking
 * something in (spec §5.7, S2-05). Each is a mutation with its own key
 * (ADR 0016); the third way out is `confirm-meetup`, from the review screen.
 */

/** Somebody the organiser could hand the plan to. */
export type HandOffCandidate = {
  userId: string;
  name: string;
  /** A guest cannot organise (spec §8.2); the sheet shows them greyed. */
  hasSavedPlace: boolean;
};

/**
 * Who could take it over: every active member but the organiser, and whether
 * each has a saved place. A definer function because `profiles` is readable by
 * its owner alone, and it answers the plan's organiser and nobody else.
 *
 * The thrown message names nothing: names are what this returns.
 */
export async function handOffCandidates(planId: string): Promise<HandOffCandidate[]> {
  const { data, error } = await authClient().rpc('hand_off_candidates', { p_plan_id: planId });
  if (error !== null) throw new Error('hand-off candidates lookup failed');
  return (data ?? []).map((row) => ({
    userId: row.member_user_id,
    name: row.display_name,
    hasSavedPlace: row.has_saved_place,
  }));
}

/** "Hand this to someone else." */
export async function handOffOrganiser(planId: string, toUserId: string): Promise<void> {
  await invokeFunction(
    'hand-off-organiser',
    HandOffOrganiserRequest.parse({
      idempotency_key: newIdempotencyKey(),
      plan_id: planId,
      to_user_id: toUserId,
    }),
    HandOffOrganiserResponse,
  );
}

/**
 * "Give it one more day." The server works out the new deadline, on its own
 * clock, and says what it is.
 */
export async function extendDeadline(planId: string): Promise<ExtendDeadlineResponse> {
  return invokeFunction(
    'extend-deadline',
    ExtendDeadlineRequest.parse({ idempotency_key: newIdempotencyKey(), plan_id: planId }),
    ExtendDeadlineResponse,
  );
}
