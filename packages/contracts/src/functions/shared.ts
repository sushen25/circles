import { z } from 'zod';

import { IdempotencyKey, RequestId } from '../ids.js';

/**
 * The envelope every Edge Function shares (architecture §7.4, §9.1).
 *
 * Bodies here are deliberately thin: this ticket fixes the names, the shapes
 * and the fact that both sides validate. The functions themselves land in
 * Slice 1, and each will grow its own request as it does.
 */

/** Every mutation is safe to retry, keyed by the client. */
export const Mutation = z.object({ idempotency_key: IdempotencyKey });

/**
 * The error shape. `reference` is the short string a person can read back to
 * us ("Ref 7F3K-2Q") — it identifies the request, never the person.
 */
export const Problem = z.object({
  error: z.enum([
    'unauthorised',
    'forbidden',
    'not_found',
    'conflict',
    'expired',
    'rate_limited',
    'invalid_request',
    'unavailable',
  ]),
  /** Plain language, safe to show. Never contains anyone's data. */
  message: z.string(),
  reference: RequestId,
});
export type Problem = z.infer<typeof Problem>;

/** Accepted, with nothing to say beyond that it worked. */
export const Accepted = z.object({ ok: z.literal(true) });
export type Accepted = z.infer<typeof Accepted>;
