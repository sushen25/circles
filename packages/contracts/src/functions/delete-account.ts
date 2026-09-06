import { z } from 'zod';

import { Mutation, Accepted } from './shared.js';

/** `delete-account` — Revoke sessions, anonymise, enqueue the purge. */
export const DeleteAccountRequest = Mutation.extend({ confirm: z.literal(true) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const DeleteAccountResponse = Accepted;
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
