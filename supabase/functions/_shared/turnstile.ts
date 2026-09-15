import { optional } from './env.ts';
import { Refusal, Unavailable } from './problem.ts';

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
 * With no secret configured the check is skipped **locally** and refused
 * **anywhere hosted**. A kit that refuses every join without a Turnstile secret
 * is a kit nobody can run, so local keeps skipping; but the same rule applied
 * to a deployed project is how §14's protection goes silently missing while
 * everything looks configured — site key in the bundle, widget rendering, token
 * posted, nothing verified, no error and no log. A secret deleted, a project
 * restored from a template, or a typo in the name is all it takes, and until
 * SUS-71 fixed the runbooks the name written down (`TURNSTILE_SECRET`) was not
 * the one read here.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Whether this is a deployed project rather than somebody's laptop.
 *
 * Taken from the Supabase URL, which the platform injects into every function,
 * because the alternative — a `CIRCLES_ENV` secret — is one more thing to set
 * and therefore one more thing to forget. A guard whose own configuration can
 * go missing reintroduces the failure it was added to close. A local stack
 * serves functions from `127.0.0.1`/`kong`; a hosted one from
 * `<ref>.supabase.co`.
 */
function isHosted(): boolean {
  const url = optional('SUPABASE_URL');
  if (url === undefined) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export function isWeb(request: Request): boolean {
  return (request.headers.get('x-circles-platform') ?? 'web').toLowerCase() === 'web';
}

export async function verifyTurnstile(request: Request, token: string | undefined): Promise<void> {
  // Native first, and before the secret is read: there is no widget on native,
  // so there is nothing to verify and nothing to be missing.
  if (!isWeb(request)) return;

  const secret = optional('TURNSTILE_SECRET_KEY');
  if (secret === undefined) {
    if (!isHosted()) return;
    // 503, not a refusal: this is ours, the caller can do nothing about it, and
    // saying so would report on whether the endpoint is armed. Nothing has been
    // done, so the idempotency claim is released and a retry is safe.
    throw new Unavailable();
  }

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
