import type { Database } from '@circles/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { sessionStorage } from './storage';

/**
 * The one Supabase client (architecture §10, §11).
 *
 * A module-level singleton rather than a React context, because two clients
 * over one storage key is a race: both refresh, one wins, the other writes a
 * refresh token that has already been spent and signs the person out. The
 * session is the client's, and there is one of each.
 *
 * Everything environment-specific arrives through `EXPO_PUBLIC_*` (§5.3), the
 * same two values the analytics transport reads. Nothing here knows a domain
 * name: the app origin is a deploy-time variable and the holding domain is
 * temporary (ADR 0001).
 */

/**
 * The platform, as the Edge Functions see it.
 *
 * `_shared/turnstile.ts` reads this header to decide whether a join needs a
 * Turnstile token, defaulting to `web` when it is absent — so the header is
 * what *exempts* native, and a missing header fails towards asking for a
 * challenge rather than skipping one. Sent on every request rather than on the
 * two that check it, so a later function that starts checking gets the truth
 * without a client change.
 */
export const PLATFORM_HEADER = 'x-circles-platform';

export function platformName(): 'web' | 'native' {
  return Platform.OS === 'web' ? 'web' : 'native';
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    // Thrown rather than defaulted: a client pointed at nothing compiles,
    // deploys, serves, and fails on every request in the browser, which is the
    // most expensive place to find out. `scripts/check-client-env.mjs` catches
    // this before a deploy; this catches it before a dev run.
    throw new Error(`${name} is not set — see docs/runbooks/environments.md`);
  }
  return value;
}

/**
 * Whether this build was given a backend at all.
 *
 * Two kinds of build exist and both are intended. A deployed app always has
 * one — `scripts/check-client-env.mjs` refuses to deploy without it — and the
 * routes S1-24 wired talk to it. The Playwright smoke export and the dev
 * gallery have none, and those same routes render their fixtures instead, so
 * every screen stays reviewable with no stack running. This is the switch, and
 * it is read from the build's own configuration rather than from a flag
 * somebody could leave on.
 */
export function hasBackend(): boolean {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return url !== undefined && url !== '' && key !== undefined && key !== '';
}

let client: SupabaseClient<Database> | undefined;

export function authClient(): SupabaseClient<Database> {
  if (client !== undefined) return client;

  client = createClient<Database>(
    required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    {
      auth: {
        storage: sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        /**
         * **Off, deliberately.** With it on, `supabase-js` inspects the URL
         * fragment on load and tries to read a session out of it. Two of this
         * product's routes carry a secret in exactly that place — `/join#<secret>`
         * above all — and the fragment is the one part of a URL a server never
         * sees, which is the entire reason the invite secret lives there (§14).
         * Letting an auth library parse it invites a library update to log,
         * forward or clear something we promised never leaves the browser.
         *
         * Nothing is lost: sign-in here is a six-digit code and, later,
         * `signInWithIdToken` (S1-14b). Neither returns a session through the
         * URL.
         */
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      global: { headers: { [PLATFORM_HEADER]: platformName() } },
    },
  );

  return client;
}

/** Drops the singleton so a test can build a fresh one. Not used in the app. */
export function resetAuthClientForTests(): void {
  client = undefined;
}
