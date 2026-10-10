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
/**
 * Three ways in, one query shape:
 *
 * - **the file, with the bearer** (`format` absent): what the app fetched before
 *   there were links, and still does when no link can be made;
 * - **a link, with the bearer** (`format=link`): `{ token, expires_at }`, a
 *   short-lived signed token for this one confirmation (ADR 0063);
 * - **the file, with the token and no bearer** (`token`): what a plain
 *   navigation sends, so iOS can open the system "Add to Calendar" sheet.
 *
 * The token is `<expiry seconds>.<base64url HMAC-SHA-256>`: 43 characters of
 * signature. The shape is checked here so a malformed one is refused before
 * anything is looked up; whether it is *good* is the function's to decide.
 */
export const CalendarToken = z.string().regex(/^\d{1,12}\.[A-Za-z0-9_-]{43}$/);

export const GenerateIcsRequest = z.object({
  confirmation_id: ConfirmationId,
  format: z.literal('link').optional(),
  token: CalendarToken.optional(),
});
export type GenerateIcsRequest = z.infer<typeof GenerateIcsRequest>;

/**
 * The answer to `format=link`. Both fields are null when the deployment has no
 * `CALENDAR_LINK_KEY`, and the app then fetches the file itself.
 */
export const GenerateIcsLinkResponse = z.object({
  token: CalendarToken.nullable(),
  expires_at: z.iso.datetime().nullable(),
});
export type GenerateIcsLinkResponse = z.infer<typeof GenerateIcsLinkResponse>;
