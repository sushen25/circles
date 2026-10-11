import { z } from 'zod';

import { OpaqueToken } from '../ids.js';

/**
 * `stop-nudges` — stopping the cadence nudge without signing in (ADR 0067).
 *
 * The link under every "time to catch up?" email opens `/n#<token>` (ADR 0023:
 * the token is in the fragment, so no server holds it). The page asks for one
 * tap and then posts the token here. The token's purpose is its own, so the
 * preferences token under a plan-update email cannot stop nudges and this one
 * cannot read or stop plan email.
 */
export const StopNudgesRequest = z.object({ token: OpaqueToken });
export type StopNudgesRequest = z.infer<typeof StopNudgesRequest>;

/**
 * `{ stopped: true }` and nothing else: no name, no circle, no address. An
 * unknown, expired or other-purpose token is a `link_expired` refusal, the
 * same for all three.
 */
export const StopNudgesResponse = z.object({ stopped: z.literal(true) });
export type StopNudgesResponse = z.infer<typeof StopNudgesResponse>;
