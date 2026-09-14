import { z } from 'zod';

import { ConfirmationId } from '../ids.js';

/**
 * `generate-ics` — the confirmed meetup as a calendar file (spec §5.7).
 *
 * A **GET**, and the only one in the kit: this is a download. The browser needs
 * a URL it can navigate to, and what comes back is `text/calendar` with a
 * `Content-Disposition`, not JSON — so there is no response schema here. A
 * schema describing a file's bytes would be a shape nothing validates.
 *
 * The request is the query string, which is why it is not a `Mutation`: it
 * writes nothing, carries no idempotency key, and can be opened twice.
 *
 * What the file must never carry is a token (architecture §14): an `.ics` is
 * forwarded, synced to other devices and indexed by desktop search. The domain's
 * `icsFor` throws rather than embedding one, and the link it does carry is the
 * plan's short link, which is a public path with no secret in it.
 */
export const GenerateIcsRequest = z.object({ confirmation_id: ConfirmationId });
export type GenerateIcsRequest = z.infer<typeof GenerateIcsRequest>;
