import { z } from 'zod';

import { Accepted, Mutation } from './shared.js';

/**
 * `delete-account` — a permanent identity deletes itself (spec §13; S4-05,
 * ADR 0083).
 *
 * Sessions are revoked and sign-in is refused from the moment it answers; the
 * person is a "Former member" to everybody else; the profile, the private rows
 * and the auth user are purged thirty days later by the retention job. Guests
 * have no account to delete and use `leave-circle`.
 *
 * The circles the caller owns are handed to the longest-standing permanent
 * member or archived when there is none; the answer says how many of each so the
 * screen can confirm what happened. `confirm` is the literal `true`: a request
 * that does not say it is a request nobody meant to send.
 *
 * Reasons: `requires_saved_place` for a guest.
 */
export const DeleteAccountRequest = Mutation.extend({ confirm: z.literal(true) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const DeleteAccountResponse = Accepted.extend({
  circles_handed_on: z.int().min(0),
  circles_archived: z.int().min(0),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
