import { emailProviderWebhook } from './handler.ts';

/**
 * `POST /functions/v1/email-provider-webhook` — Resend's delivery events
 * (architecture §13). The handler is in `handler.ts` so the suite can drive it
 * without a Deno runtime; this file is the one side effect.
 *
 * `verify_jwt = false` in `config.toml`: the provider sends a Svix signature,
 * not a Supabase JWT, so the gateway has nothing to check and the function
 * checks the signature itself — refusing everything while
 * `RESEND_WEBHOOK_SECRET` is unset.
 */
Deno.serve(emailProviderWebhook());
