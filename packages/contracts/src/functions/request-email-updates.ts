import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Mutation } from './shared.js';

/**
 * `request-email-updates` — "email me about this meetup" (spec §5.8).
 *
 * Per **plan**, not per circle: "a verified subscription to one plan", and
 * "plan-update email consent is scoped to one plan and is never a marketing
 * consent" (§8.2). An earlier draft of this schema took an optional circle id,
 * which is a subscription the product does not have.
 *
 * The address goes to the server and no further: `private.email_contacts` is
 * the only table that holds one, and no DTO, log or analytics payload ever
 * carries it (non-negotiable 8). The response says nothing about it either —
 * see below.
 */
export const RequestEmailUpdatesRequest = Mutation.extend({
  plan_id: PlanId,
  /**
   * Trimmed and lower-cased here so the client and the server agree on what
   * "the same address" means. Unicode-normalised too: `café@…` can arrive as
   * two different byte strings from two different keyboards, and a person who
   * typed the same address twice should not end up with two contacts.
   */
  email: z.string().trim().toLowerCase().normalize('NFC').max(254).pipe(z.email()),
  /**
   * The `CONSENT.version` the screen rendered when the person asked. Required:
   * a subscription is recorded under the words the person was shown, so the
   * server never fills this in from its own current version (ADR 00XX). Which
   * versions are acceptable is the server's list (`CONSENT_VERSIONS`), not this
   * schema's; an unknown one is refused as `consent_version_unknown`.
   */
  consent_version: z.string().min(1).max(32),
});
export type RequestEmailUpdatesRequest = z.infer<typeof RequestEmailUpdatesRequest>;

export const RequestEmailUpdatesResponse = z.object({
  /**
   * One answer, always, whatever happened.
   *
   * A response that said "already verified", or returned a contact id, or
   * differed for a suppressed address, would answer a question the caller is
   * not entitled to ask: *does this address exist in your system, and what has
   * it done?* Somebody could walk a list of addresses through a plan they
   * belong to and learn which of their friends have used the product.
   *
   * So: check your email. Even when nothing was sent, because the address is
   * suppressed and spec §9 says a suppressed address is never automatically
   * reactivated — the person who owns it asked not to hear from us, and that
   * has to outrank telling somebody else about it.
   */
  status: z.literal('check_email'),
});
export type RequestEmailUpdatesResponse = z.infer<typeof RequestEmailUpdatesResponse>;
