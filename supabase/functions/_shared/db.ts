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

export function asCaller(authorization: string): Db {
  return createClient(url(), required('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function asService(): Db {
  return createClient(url(), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
