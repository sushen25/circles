import { optional } from './env.ts';
import { Refusal } from './problem.ts';

/**
 * Cloudflare Turnstile, on web joins only (§14: "Turnstile on web joins").
 *
 * Native has no Turnstile widget and does not need one — the app is the
 * friction. The platform is taken from a header the client sets, which means a
 * caller can claim to be native and skip the check. That is a known and
 * accepted limit, and it is why nothing here is load-bearing: Turnstile raises
 * the cost of scripted joins, while the invite secret, the member cap and the
 * per-IP limit are what actually hold.
 *
 * With no secret configured the check is *skipped*, not failed. Local
 * development has no Turnstile, and a kit that refuses every join without one
 * is a kit nobody can run.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isWeb(request: Request): boolean {
  return (request.headers.get('x-circles-platform') ?? 'web').toLowerCase() === 'web';
}

export async function verifyTurnstile(request: Request, token: string | undefined): Promise<void> {
  const secret = optional('TURNSTILE_SECRET_KEY');
  if (secret === undefined || !isWeb(request)) return;

  if (token === undefined || token === '') {
    throw new Refusal('too_many_requests', 'That did not go through. Please try again.');
  }

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);

  const answer = await fetch(VERIFY_URL, { method: 'POST', body });
  const result = (await answer.json()) as { success?: boolean };

  if (result.success !== true) {
    // Nothing from Cloudflare's `error-codes` is repeated back: it describes the
    // challenge, and the person on the other end can do nothing with it.
    throw new Refusal('too_many_requests', 'That did not go through. Please try again.');
  }
}
