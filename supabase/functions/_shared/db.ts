import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { required } from './env.ts';

/**
 * Two clients, and the difference between them is the whole authorisation model.
 *
 * `asCaller` carries the caller's own JWT, so `auth.uid()` inside a definer
 * function is the person who made the request and RLS applies to every read.
 * Almost everything goes through it: a rule the database enforces cannot be got
 * wrong by a function that forgets to check.
 *
 * `asService` bypasses RLS. It exists for the kit's own bookkeeping — the
 * idempotency record and the rate counters, which belong to no user — and for
 * `claim-identity`, whose authorisation is a second token this function has
 * verified and the database cannot see. Reaching for it anywhere else is how a
 * policy stops being load-bearing, so each use says why.
 */

export type Db = SupabaseClient;

function url(): string {
  return required('SUPABASE_URL');
}

/**
 * How long one call to PostgREST or the auth server may take.
 *
 * supabase-js sets none, so a stuck upstream held the function to the platform's
 * wall-clock limit, and in the scheduler could outlive its 90 s lease. Ten
 * seconds is several times the slowest call the functions make (the scheduler's
 * claim and result RPCs are single statements over indexed rows), and a caller
 * that brings its own signal keeps it.
 */
export const DB_TIMEOUT_MS = 10_000;

export function timeBounded(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): ReturnType<typeof fetch> {
  // `fetch` is read at call time, so a test's stub and a runtime's own both apply.
  return fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) });
}

export function asCaller(authorization: string): Db {
  return createClient(url(), required('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization }, fetch: timeBounded },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function asService(): Db {
  return createClient(url(), required('SUPABASE_SERVICE_ROLE_KEY'), {
    global: { fetch: timeBounded },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
