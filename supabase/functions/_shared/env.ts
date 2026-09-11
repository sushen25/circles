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
