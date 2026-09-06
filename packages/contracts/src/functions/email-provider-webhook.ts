import { z } from 'zod';

import { Instant } from '../time.js';
import { Accepted } from './shared.js';

/** `email-provider-webhook` — Resend delivery events, deduped by provider message id. Signature-verified, never trusted as a caller. */
export const EmailProviderWebhookRequest = z.object({
  provider_message_id: z.string().min(1),
  code: z.enum(['delivered', 'bounced', 'complained', 'deferred', 'failed']),
  occurred_at: Instant,
});
export type EmailProviderWebhookRequest = z.infer<typeof EmailProviderWebhookRequest>;

export const EmailProviderWebhookResponse = Accepted;
export type EmailProviderWebhookResponse = z.infer<typeof EmailProviderWebhookResponse>;
