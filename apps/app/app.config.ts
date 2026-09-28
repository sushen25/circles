import type { ExpoConfig } from 'expo/config';

import { APP_LINK_PATHS, brand } from '@circles/config';

/**
 * Every user-visible string and host comes from `@circles/config` (§5.4); every
 * environment-specific value comes from `EXPO_PUBLIC_*` (§5.3). The client
 * bundle carries only the Supabase URL, the anon key, the Turnstile site key
 * and the app origin — every other secret lives in Edge Function secrets.
 */
type AppEnv = 'development' | 'preview' | 'production';

const APP_ENVS: readonly AppEnv[] = ['development', 'preview', 'production'];

function resolveAppEnv(): AppEnv {
  // EAS sets EAS_BUILD_PROFILE; locally the profile is named explicitly.
  const raw = process.env.EXPO_PUBLIC_APP_ENV ?? process.env.EAS_BUILD_PROFILE ?? 'development';
  const found = APP_ENVS.find((env) => env === raw);
  if (!found) {
    throw new Error(`Unknown app environment "${raw}" — expected one of ${APP_ENVS.join(', ')}`);
  }
  return found;
}

const appEnv = resolveAppEnv();

// Native builds fetch the one server route (the link-preview endpoint, §9.4)
// with a relative path, so `origin` has to be set for them to resolve.
//
// The fallback follows the environment. Falling back to the brand domain in
// development pointed local runs at a host that does not resolve, which fails
// only on native and only at the moment the route is fetched.
const appOrigin =
  process.env.EXPO_PUBLIC_APP_ORIGIN ??
  (appEnv === 'development' ? 'http://localhost:8081' : `https://${brand.domain}`);

// `circles` stays the identifier prefix whatever the product is called (§5.4).
const bundleIdentifier = `app.circles.${appEnv}`;

// Created by `eas init`. Not a secret, and EAS needs it to resolve the project,
// so it is committed rather than read from the environment — a dynamic config
// cannot be written back to by the CLI.
const easProjectId = '81371189-91d3-4ee8-859c-bf60a35ca7e0';

// The EAS account that owns the project, the paid plan and the CI robot. All
// three must be the same account: `eas init` put the project on the personal
// account while the robot was created on the organisation, and every deploy
// failed with a message that named the app but never the viewer. Stating the
// owner here means a mismatch is a clear error instead of a silent one.
const easOwner = 'sushen25s-team';

// Universal links and App Links (architecture §5.2): the installed app claims
// the product's link paths on the live host, and nothing else there. The list
// is `APP_LINK_PATHS`, which the two well-known files the host serves are
// tested against; the host is always the brand's, because that is the domain
// the links in the world point at, whichever backend this build talks to.
// Until S3-01b fills the well-known files with the real team id and signing
// fingerprint, neither platform verifies the claim, and a link opens the
// browser unless it is sent to the app by name (`adb shell am start -p …`).
const linkHost = brand.domain;

const androidIntentFilters = [
  {
    action: 'VIEW',
    autoVerify: true,
    category: ['BROWSABLE', 'DEFAULT'],
    data: APP_LINK_PATHS.map((entry) =>
      entry.match === 'exact'
        ? { scheme: 'https', host: linkHost, path: entry.path }
        : { scheme: 'https', host: linkHost, pathPrefix: entry.path },
    ),
  },
];

const config: ExpoConfig = {
  owner: easOwner,
  name: brand.name,
  slug: 'circles',
  scheme: brand.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier,
    supportsTablet: true,
    associatedDomains: [`applinks:${linkHost}`],
  },
  android: {
    package: bundleIdentifier,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: androidIntentFilters,
  },
  // EAS Update: one channel per build profile (see eas.json). `appVersion`
  // ties the runtime to the version above, so a native change forces a build
  // rather than silently shipping an incompatible update.
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    url: `https://u.expo.dev/${easProjectId}`,
  },
  web: {
    bundler: 'metro',
    // Server output exists for exactly one route: link previews (ADR 0001).
    output: 'server',
    favicon: './assets/favicon.png',
  },
  plugins: [
    // `origin` polyfills relative fetches in production builds, so native can
    // reach the one server route (link previews, §9.4) — the caveat ADR 0001
    // calls out. The app itself never calls it; link fetchers do.
    [
      'expo-router',
      {
        origin: appOrigin,
        // `app/+middleware.ts` serves the link-preview card on the paths people
        // actually paste — `/join`, `/j/<code>`, `/p/<code>` — which are client
        // pages, and a page and an API route cannot share a path. Without this
        // the card exists only at `/og/...`, where no chat app ever asks for it.
        unstable_useServerMiddleware: true,
        // `headers` applies to every HTML and API-route response the server
        // output serves. Both entries below are load-bearing and they were
        // found from opposite directions, so neither is a default to tidy away.
        //
        // **The page HTML is not cached at the edge, and that is what makes the
        // card work.** A cached response is served before the middleware runs,
        // so one person opening `/j/<code>` put the app shell in the CDN under
        // that URL and every chat app that fetched it afterwards got the shell
        // instead of a preview — for an hour, and for ever on `/join`, which is
        // one URL for every invite in the product.
        //
        // The cost is the HTML itself, which is a small shell; the bundles,
        // images and fonts it points at are static assets with their own
        // caching and are untouched. Correctness at the product's front door is
        // worth more than an edge hit on 50 KB.
        //
        // `Referrer-Policy: no-referrer` is the one §14 names, and it is
        // load-bearing rather than hygiene: an invite secret rides in the URL
        // fragment and a plan code in the path, so a referrer sent to whatever
        // the landing page links out to is exactly how either escapes. EAS
        // Hosting sets no referrer policy of its own, so without this the
        // deployed app serves none — `pnpm check:env` fails on it, which is how
        // it was found.
        //
        // One limit that applies to both: they do not reach redirect responses
        // or static assets. Neither of those carries a secret. A route that
        // sets either header itself still wins.
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      },
    ],
    'expo-font',
    'expo-secure-store',
    'expo-splash-screen',
  ],
  extra: {
    appEnv,
    appOrigin,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY,
    eas: { projectId: easProjectId },
  },
};

export default config;
