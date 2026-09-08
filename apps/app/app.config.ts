import type { ExpoConfig } from 'expo/config';

import { brand } from '@circles/config';

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
const appOrigin = process.env.EXPO_PUBLIC_APP_ORIGIN ?? `https://${brand.domain}`;

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
    ['expo-router', { origin: appOrigin }],
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
