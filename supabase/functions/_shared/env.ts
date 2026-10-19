/**
 * Configuration, read when it is needed rather than when the module loads.
 *
 * At import time an Edge Function has no request and nothing to fail for, so a
 * module-level `Deno.env.get(...)!` turns a missing secret into a function that
 * will not boot, with the reason in a deploy log nobody is reading. Read late
 * and the same mistake is one request failing loudly with the variable's name.
 *
 * The unit tests run under Node, where `Deno` does not exist; `process.env` is
 * the fallback so the kit can be exercised without a Deno runtime.
 */

interface EnvSource {
  get(key: string): string | undefined;
}

function source(): EnvSource {
  const deno = (globalThis as { Deno?: { env: EnvSource } }).Deno;
  if (deno !== undefined) return deno.env;

  const node = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  if (node !== undefined) return { get: (key) => node.env[key] };

  return { get: () => undefined };
}

/** A setting the function cannot run without. */
export function required(name: string): string {
  const value = source().get(name);
  if (value === undefined || value === '') {
    throw new Error(`missing configuration: ${name}`);
  }
  return value;
}

/** A setting with a sensible absence — a feature that is simply off. */
export function optional(name: string): string | undefined {
  const value = source().get(name);
  return value === undefined || value === '' ? undefined : value;
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
export function isHosted(): boolean {
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
