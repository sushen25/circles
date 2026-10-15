import { z } from 'zod';

import { OpaqueToken } from '../ids.js';

/**
 * `stop-letters` — stopping a family of account-holder letters without signing
 * in (ADR 0067 for the cadence nudge, ADR 0069 for the rest).
 *
 * The link under each such letter opens `/n#<token>`, `/o#<token>` or
 * `/q#<token>` (ADR 0023: the token is in the fragment, so no server holds it).
 * The path says which family the page is about; the page asks for one tap and
 * then posts the token and that family here. Each family has a token purpose of
 * its own, so a token under one family's letter stops nothing in another, and
 * the preferences token under a plan-update email stops none of them.
 */
export const STOP_FAMILIES = ['nudges', 'organiser', 'quiet'] as const;
export const StopFamily = z.enum(STOP_FAMILIES);
export type StopFamily = z.infer<typeof StopFamily>;

export const StopLettersRequest = z.object({ token: OpaqueToken, family: StopFamily });
export type StopLettersRequest = z.infer<typeof StopLettersRequest>;

/**
 * `{ stopped: true }` and nothing else: no name, no circle, no address. An
 * unknown, expired, other-family or other-purpose token is a `link_expired`
 * refusal, the same for all of them.
 */
export const StopLettersResponse = z.object({ stopped: z.literal(true) });
export type StopLettersResponse = z.infer<typeof StopLettersResponse>;
