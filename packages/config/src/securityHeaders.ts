/**
 * The security headers the web app sends on every HTML response (SUS-119).
 *
 * Pure: `app.config.ts` computes the one hash and reads the one environment
 * variable, and hands them in, so a test can say exactly what is sent.
 *
 * **Why the policy matters here in particular.** On web the Supabase session,
 * refresh token included, lives in `localStorage` (architecture §10), so one
 * script injection on the origin would be a lasting takeover. The policy is
 * the second wall: scripts run only if they come from this origin, from
 * Cloudflare's challenge, or are the one inline script the router writes.
 */

/**
 * The one inline script Expo Router writes into every exported page. The
 * policy allows it by hash, so the hash is computed from this string in
 * `app.config.ts`; `tests/e2e-live/served-html.spec.ts` then reads the script
 * out of the served HTML and checks its hash is in the header, so a router that
 * changes it fails a test instead of blanking the app.
 */
export const HYDRATE_SCRIPT = 'globalThis.__EXPO_ROUTER_HYDRATE__=true;';

/** Turnstile (architecture §14) loads its script and frame from here, and nothing else does. */
const TURNSTILE = 'https://challenges.cloudflare.com';

/** The origin of a URL, or `undefined` for anything that is not one. */
export function originOfUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const { origin } = new URL(value);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * `react-native-web` writes its styles as inline `style` attributes and a
 * `<style>` element, so `style-src` needs `'unsafe-inline'`. Styles cannot run
 * script, which is why that is the one concession.
 */
export function contentSecurityPolicy({
  hydrateScriptHash,
  supabaseUrl,
}: {
  /** `sha256-<base64>` of {@link HYDRATE_SCRIPT}. */
  hydrateScriptHash: string;
  /** `EXPO_PUBLIC_SUPABASE_URL` at build time; none in the no-backend smoke build. */
  supabaseUrl: string | undefined;
}): string {
  const supabase = originOfUrl(supabaseUrl);
  return [
    `default-src 'self'`,
    `script-src 'self' '${hydrateScriptHash}' ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    `connect-src ${["'self'", ...(supabase ? [supabase] : []), TURNSTILE].join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');
}

/** What no page here has any use for. */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

export function securityHeaders(options: Parameters<typeof contentSecurityPolicy>[0]): {
  'Content-Security-Policy': string;
  'X-Content-Type-Options': 'nosniff';
  'Permissions-Policy': string;
} {
  return {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': PERMISSIONS_POLICY,
  };
}

/**
 * The policy for a page the server writes itself, whole, with no script at all:
 * the marketing site and the link-preview card. Their middleware responses do
 * not pass through the router's `headers`, so they carry it themselves. The
 * only things such a page loads are its inline `<style>` and the app's own
 * fonts and icons.
 */
export const STATIC_PAGE_POLICY = [
  `default-src 'none'`,
  `style-src 'unsafe-inline'`,
  `font-src 'self'`,
  `img-src 'self' data:`,
  `manifest-src 'self'`,
  `frame-ancestors 'none'`,
  `base-uri 'none'`,
  `form-action 'none'`,
].join('; ');
