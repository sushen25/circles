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

/** Cloudflare answers in well under a second; five is generous and still far inside the wall-clock limit. */
export const TURNSTILE_TIMEOUT_MS = 5_000;

function isTimeout(thrown: unknown): boolean {
  const name = (thrown as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Hosts a function runs behind on a laptop: the CLI's own, the Docker network's
 * name for the API gateway, and the host alias containers use.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'kong', 'host.docker.internal']);

/**
 * Whether this is a deployed project rather than somebody's laptop.
 *
 * **An explicit value wins:** `CIRCLES_ENV` is `hosted` or `local`. It exists
 * because the URL's shape is a guess about the platform — a custom domain
 * changes what `SUPABASE_URL` says inside a function, and a test that ends in
 * `.supabase.co` then quietly reads "local", skips the check, and leaves §14's
 * protection off with every visible sign saying it is on.
 *
 * **Without it, the guess fails closed.** Anything that is not a known local
 * host is treated as hosted, so a custom domain is refused rather than waved
 * through, and the secret that is missing is the new one, not the check. A
 * deployment therefore needs no new secret to be safe; setting `CIRCLES_ENV`
 * only makes the answer a statement rather than an inference. (An absent or
 * unparseable URL is "local": the platform always injects one, so that is the
 * unit tests' world and nothing deployed.)
 */
function isHosted(): boolean {
  const declared = optional('CIRCLES_ENV')?.toLowerCase();
  if (declared === 'hosted') return true;
  if (declared === 'local') return false;

  const url = optional('SUPABASE_URL');
  if (url === undefined) return false;
  try {
    return !LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The hostnames a solved challenge may name (`TURNSTILE_ALLOWED_HOSTNAMES`, a
 * comma-separated list), or `undefined` when none is configured.
 *
 * Cloudflare reports the hostname the widget was solved on. A token solved on
 * some other site that shares the secret, or in a harness that uses the same
 * site key, is otherwise as good as one from ours. Optional so that the check
 * can be armed after the code ships, and so `dev`, which uses Cloudflare's
 * dummy key and gets a placeholder hostname back, is not made unusable.
 */
function allowedHostnames(): string[] | undefined {
  const raw = optional('TURNSTILE_ALLOWED_HOSTNAMES');
  if (raw === undefined) return undefined;
  const names = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
  return names.length === 0 ? undefined : names;
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

  // A stuck Cloudflare would otherwise hold the join to the platform's
  // wall-clock limit. Nothing has been done yet, so the same 503 as an unarmed
  // check is right: the claim is released and a retry is safe. The signal also
  // covers reading the body.
  let result: { success?: boolean; hostname?: unknown };
  try {
    const answer = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    result = (await answer.json()) as { success?: boolean; hostname?: unknown };
  } catch (thrown) {
    if (isTimeout(thrown)) throw new Unavailable();
    throw thrown;
  }

  if (result.success !== true) {
    // Nothing from Cloudflare's `error-codes` is repeated back: it describes the
    // challenge, and the person on the other end can do nothing with it.
    throw new Refusal('too_many_requests', 'That did not go through. Please try again.');
  }

  // A good token, solved somewhere else, is not ours. When the list is set a
  // missing hostname fails too: Cloudflare always sends one on success.
  const allowed = allowedHostnames();
  if (allowed !== undefined) {
    const solvedOn = typeof result.hostname === 'string' ? result.hostname.toLowerCase() : '';
    if (!allowed.includes(solvedOn)) {
      throw new Refusal('too_many_requests', 'That did not go through. Please try again.');
    }
  }
}
