import { z } from 'zod';

import { ContactId, OpaqueToken } from '../ids.js';

/** `verify-email-contact` — Consume the single-use token, activate the subscription, send any still-relevant update. */
export const VerifyEmailContactRequest = z.object({ token: OpaqueToken });
export type VerifyEmailContactRequest = z.infer<typeof VerifyEmailContactRequest>;

export const VerifyEmailContactResponse = z.object({ contact_id: ContactId });
export type VerifyEmailContactResponse = z.infer<typeof VerifyEmailContactResponse>;
