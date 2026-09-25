import { z } from 'zod';

import { PlanId, UserId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `accept-organiser` — take the organiser role on an opened quiet plan that has
 * none (spec §5.4.5). First writer wins.
 *
 * **No role in the request.** How somebody comes to organise — as the
 * initiator's "I'll organise", a keen member's "I'll pick the time", or the
 * owner's fallback once replies close — is worked out by the server and never
 * stored, returned or reported: `initiator` beside the organiser's now-public
 * name *is* the initiator (SUS-49). A client that sent it would be a client
 * that knew it, and a request body is logged by more than us.
 *
 * Refusals: `requires_saved_place` (a guest), `not_keen`, `deadline_not_passed`
 * (the owner, before replies close), `already_taken`, `wrong_state` (still
 * asking), `plan_is_finished`, `not_quiet`, `plan_not_found`.
 */
export const AcceptOrganiserRequest = Mutation.extend({ plan_id: PlanId });
export type AcceptOrganiserRequest = z.infer<typeof AcceptOrganiserRequest>;

/** The caller, now the organiser — a public fact from here on (§4.5). */
export const AcceptOrganiserResponse = z.object({ organiser_member_id: UserId });
export type AcceptOrganiserResponse = z.infer<typeof AcceptOrganiserResponse>;
