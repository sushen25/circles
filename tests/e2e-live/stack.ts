import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The local stack, as the live suite sees it.
 *
 * Everything is read from `supabase status` rather than written down — the
 * local keys are published demo values, but they are shaped like credentials
 * and gitleaks is right not to care which (see `journey.integration.test.ts`).
 *
 * Setup and assertions go through `psql` as `postgres`, deliberately around
 * the client: the page under test is the only thing that should be using the
 * product's own paths, and a test that seeded through them would be testing
 * itself.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export type StackConfig = { apiUrl: string; anonKey: string; dbUrl: string; serviceKey: string };

export function stackConfig(): StackConfig {
  const raw = execFileSync(resolve(ROOT, 'node_modules/.bin/supabase'), ['status', '-o', 'json'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string>;
  const config = {
    apiUrl: status.API_URL ?? '',
    anonKey: status.ANON_KEY ?? '',
    dbUrl: status.DB_URL ?? '',
    // Only for making a test account through the auth server's admin API; the
    // page under test never sees it.
    serviceKey: status.SERVICE_ROLE_KEY ?? '',
  };
  if (
    config.apiUrl === '' ||
    config.anonKey === '' ||
    config.dbUrl === '' ||
    config.serviceKey === ''
  ) {
    throw new Error('the local stack is not up — `pnpm db:start`');
  }
  return config;
}

/** One query, rows as tab-separated fields. Values are interpolated by the caller from ids it minted. */
export function sql(query: string): string[][] {
  const out = execFileSync(
    'psql',
    [stackConfig().dbUrl, '-v', 'ON_ERROR_STOP=1', '-qAt', '-F', '\t', '-c', query],
    {
      encoding: 'utf8',
    },
  );
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));
}

/** The short-code alphabet: no i, l, o, 0 or 1. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function shortCode(): string {
  return Array.from(randomBytes(10), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export type Scenario = {
  circleId: string;
  planCode: string;
  planId: string;
  ownerId: string;
  /** The invite fragment. Held by the test only, to assert it never leaves the page. */
  secret: string;
};

/**
 * Sunday Crew, fresh for one test: Maya owns it and has a saved place, a live
 * invite, and a named plan collecting answers.
 *
 * Written the way `supabase/seed.sql` writes a scenario — the circle row
 * directly, the plan through `planning.transition_plan` — so every trigger
 * fires. New ids and codes per call, so tests run in parallel and a local
 * rerun never collides with the last one.
 */
export function sundayCrew({ withPlan = true }: { withPlan?: boolean } = {}): Scenario {
  const ownerId = randomUUID();
  const circleId = randomUUID();
  const planId = randomUUID();
  const planCode = shortCode();
  const circleCode = shortCode();
  const secret = randomBytes(32).toString('base64url');

  const planSql = `
    insert into public.plans (
      id, circle_id, mode, state, organiser_user_id, title, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, response_deadline, short_code
    ) values (
      '${planId}', '${circleId}', 'named', 'draft', '${ownerId}', 'Catch up', 'Australia/Melbourne',
      current_date + 7, current_date + 13, 1050, 1350, 120, 2, now() + interval '3 days', '${planCode}'
    );
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${planId}', 1, '${ownerId}');
    select planning.transition_plan('${planId}', 'create_named', '${ownerId}');
  `;

  sql(`
    begin;
    insert into auth.users (
      id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '${ownerId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${ownerId}@example.test', false, '{"is_anonymous": false}',
      '{"display_name": "Maya", "time_zone": "Australia/Melbourne"}', now(), now()
    );
    insert into public.circles (id, owner_user_id, name, color, time_zone, cadence, short_code, creation_key)
    values ('${circleId}', '${ownerId}', 'Sunday Crew', 'sky', 'Australia/Melbourne', 'monthly',
      '${circleCode}', 'e2e-${circleId}');
    insert into public.circle_members (circle_id, user_id, display_name_snapshot, role)
    values ('${circleId}', '${ownerId}', 'Maya', 'owner');
    insert into public.circle_invites (circle_id, secret_hash, created_by)
    values ('${circleId}', extensions.digest('${secret}', 'sha256'), '${ownerId}');
    ${withPlan ? planSql : ''}
    commit;
  `);

  return { circleId, planCode, planId, ownerId, secret };
}

/** The active member of the circle by display name, and whether that identity is a guest. */
export function memberNamed(
  circleId: string,
  name: string,
): { userId: string; anonymous: boolean } | undefined {
  const [row] = sql(`
    select m.user_id, u.is_anonymous
    from public.circle_members m join auth.users u on u.id = m.user_id
    where m.circle_id = '${circleId}' and m.status = 'active' and m.display_name_snapshot = '${name}'
  `);
  return row === undefined ? undefined : { userId: row[0]!, anonymous: row[1] === 't' };
}

/**
 * A guest already in the circle — Tom — who has answered, and whose session is
 * about to be lost. Written as `postgres`, then answered through
 * `replace_response` as Tom, so the answer is the product's own.
 */
export function guestWhoAnswered(scenario: Scenario, name: string): string {
  const userId = randomUUID();
  sql(`
    begin;
    insert into auth.users (
      id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      null, true, '{"is_anonymous": true}',
      '{"display_name": "${name}", "time_zone": "Australia/Melbourne"}', now(), now()
    );
    insert into public.circle_members (circle_id, user_id, display_name_snapshot)
    values ('${scenario.circleId}', '${userId}', '${name}');
    insert into public.plan_participants (plan_id, revision, user_id)
    values ('${scenario.planId}', 1, '${userId}') on conflict do nothing;
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims',
      '{"sub": "${userId}", "role": "authenticated", "is_anonymous": true}', true);
    select public.replace_response('${scenario.planId}', 1, 'flexible');
    commit;
  `);
  return userId;
}

/** A verified contact for `userId` and a live re-entry token, as the email sender issues one. */
export function reentryTokenFor(scenario: Scenario, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  sql(`
    begin;
    insert into private.email_contacts (user_id, email_normalized, status, verified_at)
    values ('${userId}', '${userId}@example.test', 'verified', now());
    select public.issue_reentry_token('${scenario.circleId}', '${userId}',
      extensions.digest('${token}', 'sha256'));
    commit;
  `);
  return token;
}

/** Whose answer the plan holds now. */
export function responderIds(planId: string): string[] {
  return sql(`select user_id from public.plan_responses where plan_id = '${planId}'`).map(
    ([id]) => id!,
  );
}

/** Rate counters are per address, and every local run comes from the same one. */
export function clearRateCounters(): void {
  sql('delete from jobs.rate_counters');
}

/**
 * A plan that is not taking answers, in each of the ways one can be (ADR 0022).
 * Written around the machine as `postgres`, with its marker, because the test
 * is about what the page does with a plan in that state, not about getting it
 * there.
 */
export function planStopsAsking(
  scenario: Scenario,
  how: 'deadline_passed' | 'cancelled' | 'quiet_ask',
): void {
  if (how === 'deadline_passed') {
    sql(`update public.plans set response_deadline = now() - interval '1 minute'
         where id = '${scenario.planId}'`);
    return;
  }
  if (how === 'cancelled') {
    sql(`
      begin;
      select set_config('circles.in_transition', 'on', true);
      update public.plans set state = 'cancelled' where id = '${scenario.planId}';
      commit;
    `);
    return;
  }
  // A quiet ask still gathering interest: nobody organises it yet, and its link
  // is never shared (spec §5.8) — but its code exists, and must admit nobody.
  sql(`
    begin;
    select set_config('circles.in_transition', 'on', true);
    update public.plans
    set mode = 'quiet', state = 'seeking', organiser_user_id = null, quiet_threshold = 2,
        quiet_expires_at = now() + interval '2 days'
    where id = '${scenario.planId}';
    commit;
  `);
}

/** Whether the plan is asking this person, which is what lets them answer it. */
export function isParticipant(planId: string, userId: string): boolean {
  const [row] = sql(`select count(*) from public.plan_participants
    where plan_id = '${planId}' and user_id = '${userId}'`);
  return row?.[0] === '1';
}

/**
 * An account with a saved place, signed in, as the session the app keeps.
 *
 * Made through the auth server's admin API and signed in with a password the
 * test generates and never prints; the sign-in screens are S1-22's. What comes
 * back is the session exactly as `supabase-js` stores it in `localStorage`, for
 * the test to put there before the page loads.
 */
export async function signedInAccount(name: string): Promise<{ userId: string; stored: string }> {
  const { apiUrl, anonKey, serviceKey } = stackConfig();
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(24).toString('base64url');

  const created = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name, time_zone: 'Australia/Melbourne' },
    }),
  });
  if (!created.ok) throw new Error(`could not create a test account (${created.status})`);

  const signedIn = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`could not sign the test account in (${signedIn.status})`);
  const session = (await signedIn.json()) as { user: { id: string } };
  return { userId: session.user.id, stored: JSON.stringify(session) };
}

/** Where `supabase-js` keeps the session for the local API (`sb-<host's first label>-auth-token`). */
export function sessionStorageKey(): string {
  return `sb-${new URL(stackConfig().apiUrl).hostname.split('.')[0]}-auth-token`;
}

/**
 * What `userId` answered, as the database holds it: the status, and each window
 * as Melbourne wall-clock text ("2026-09-26 17:30"), which is what the painter
 * showed them.
 */
export function answerOf(
  planId: string,
  userId: string,
): { status: string; windows: string[] } | undefined {
  const [row] = sql(`
    select r.status,
      coalesce(string_agg(
        to_char(w.starts_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD HH24:MI') || '–' ||
        to_char(w.ends_at at time zone 'Australia/Melbourne', 'HH24:MI'),
        ',' order by w.starts_at), '')
    from public.plan_responses r
    left join public.willing_windows w on w.response_id = r.id
    where r.plan_id = '${planId}' and r.user_id = '${userId}'
    group by r.status
  `);
  if (row === undefined) return undefined;
  return { status: row[0]!, windows: row[1] === '' ? [] : row[1]!.split(',') };
}

/** The first day the plan asks about, as a date. */
export function firstDayOf(planId: string): string {
  return sql(`select window_start from public.plans where id = '${planId}'`)[0]![0]!;
}
