import { brand } from '@circles/config';

/**
 * Where the link-preview card's absolute URLs point, and which backend it asks
 * for a circle's name (SUS-128).
 *
 * **The server bundle does not have the `EXPO_PUBLIC_*` variables.** Metro
 * inlines them into the client bundle only; server code reads `process.env`
 * at run time ("Servers read from the environment", babel-preset-expo). On EAS
 * Hosting the run-time environment is what `eas deploy` uploads with the
 * deployment: the project's `.env*` files, plus EAS environment variables when
 * `--environment` is passed. The deploy workflows set the variables in the
 * shell, which is neither, so production served cards whose `og:image` and
 * refresh named the request's own host — the per-deployment `*.expo.app` one,
 * never `wenna.app` (architecture §5.2) — and every card said "A circle",
 * because the name lookup had no Supabase URL either.
 *
 * What the server bundle *does* carry is the app config: babel-preset-expo
 * replaces `process.env.APP_MANIFEST` with `app.config.ts`'s output, evaluated
 * when the export ran, in web and server bundles alike. `extra` there holds
 * the environment, the origin and the Supabase pair the deploy set. That is a
 * build-time constant the deployment cannot lose, so it is what a production
 * card trusts.
 */

/** What `app.config.ts` decided when the bundle was exported. */
export interface ExportedConfig {
  appEnv: string | null;
  appOrigin: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

const NOTHING_EXPORTED: ExportedConfig = {
  appEnv: null,
  appOrigin: null,
  supabaseUrl: null,
  supabaseAnonKey: null,
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The inlined manifest, read defensively. Absent under a test runner and under
 * anything that is not a Metro web or server bundle; never a throw, because a
 * card that cannot be built is a 500 on the link the product hangs off.
 */
export function exportedConfig(manifest: string | undefined): ExportedConfig {
  if (manifest === undefined || manifest === '') return NOTHING_EXPORTED;
  try {
    const parsed: unknown = JSON.parse(manifest);
    const extra: unknown =
      typeof parsed === 'object' && parsed !== null ? (parsed as { extra?: unknown }).extra : null;
    if (typeof extra !== 'object' || extra === null) return NOTHING_EXPORTED;
    const fields = extra as Record<string, unknown>;
    return {
      appEnv: text(fields['appEnv']),
      appOrigin: text(fields['appOrigin']),
      supabaseUrl: text(fields['supabaseUrl']),
      supabaseAnonKey: text(fields['supabaseAnonKey']),
    };
  } catch {
    return NOTHING_EXPORTED;
  }
}

/**
 * Production's origin: the exported one, or the brand domain — and never a
 * vendor host. A production card that named `*.expo.app` would put a link on
 * a host §5.2 forbids, tied to one deployment, into a chat app's cache.
 */
function productionOrigin(configured: string | null): string {
  const fallback = `https://${brand.domain}`;
  if (configured === null) return fallback;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.hostname.endsWith('.expo.app')) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

/**
 * The origin to build a card's absolute URLs from.
 *
 * - **Production** trusts the export and nothing about the request: on EAS
 *   Hosting the request URL is the deployment's own `*.expo.app` host even
 *   when the person pasted `wenna.app`.
 * - **Everything else** — `dev`, per-PR previews, local — is served on its own
 *   host by design, so it keeps what it always did: the run-time variable if
 *   there is one, and the request's own origin otherwise. A preview's card
 *   sends a crawler to that preview, not to `dev`.
 */
export function resolveOrigin(
  requestOrigin: string,
  runtimeOrigin: string | undefined,
  exported: ExportedConfig,
): string {
  if (exported.appEnv === 'production') return productionOrigin(exported.appOrigin);
  return text(runtimeOrigin) ?? requestOrigin;
}

/**
 * The backend to look a code up in: the run-time pair where the server has
 * one (local, `expo serve`), and the exported pair otherwise (EAS Hosting).
 * Taken as a pair, so a URL from one place is never sent another's key.
 */
export function resolveSupabase(
  runtime: { url: string | undefined; key: string | undefined },
  exported: ExportedConfig,
): { url: string; key: string } | null {
  const url = text(runtime.url);
  const key = text(runtime.key);
  if (url !== null && key !== null) return { url, key };
  if (exported.supabaseUrl !== null && exported.supabaseAnonKey !== null) {
    return { url: exported.supabaseUrl, key: exported.supabaseAnonKey };
  }
  return null;
}
