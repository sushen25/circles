import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql } from '../testing/stack.integration';

/**
 * The acceptance criterion, against the real thing.
 *
 * "A guest who joined a circle, then signs in with an email code, keeps the
 * membership." Every other test in this module mocks the auth server, and a
 * mock is precisely what cannot answer this: the question is whether Supabase
 * Auth, `handle_new_user`, RLS and `claim-identity` agree with each other about
 * who somebody is after their session has been replaced.
 *
 * It needs `pnpm db:start`. It runs in `pnpm check` after `db:test`, so the
 * schema is fresh and the stack is up — see `vitest.integration.config.ts` for
 * why it is a separate command rather than a skip.
 *
 * **If the functions answer `BOOT_ERROR`**, the edge runtime's view of the
 * built `dist` folders has gone stale — it happens after the container has been up
 * for days, and the file it names exists on the host. `pnpm db:stop &&
 * pnpm db:start` fixes it; nothing less does, including restarting that
 * container on its own.
 */

let SUPABASE_URL = '';
let ANON_KEY = '';
let MAILPIT = '';
let DB_URL = '';

let STACK: ReturnType<typeof readStackConfig> | undefined;

/** The stack config, for the helpers that take the whole thing. */
function stack(): ReturnType<typeof readStackConfig> {
  if (STACK === undefined) throw new Error('readStack has not run');
  return STACK;
}

function readStack(): void {
  STACK = readStackConfig();
  ({ url: SUPABASE_URL, anonKey: ANON_KEY, mailpit: MAILPIT, dbUrl: DB_URL } = STACK);
}

/**
 * The owner and their circle, built with a throwaway client.
 *
 * Deliberately not through the module under test: that module owns exactly one
 * client and one session, which is correct for an app and useless for a test
 * that needs two people. The guest below is the one driven through it.
 */
async function circleWithInvite(): Promise<{ circleId: string; secret: string }> {
  const owner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Its own key, even though it persists nothing. Two clients on one
      // storage key is the exact race `client.ts` refuses to allow in the app —
      // both refresh, one wins, the other writes a spent token — and GoTrue
      // warns about it. A test that produces the warning it is meant to prevent
      // teaches the reader to ignore it.
      storageKey: 'circles.test.owner',
    },
  });
  const address = someone('owner');

  const sent = await owner.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: true },
  });
  expect(sent.error).toBeNull();

  const verified = await owner.auth.verifyOtp({
    email: address,
    token: await codeFor(MAILPIT, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();

  const { data, error } = await owner.functions.invoke('create-circle', {
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      name: 'Sunday Crew',
      color: 'sky',
      time_zone: 'Australia/Melbourne',
      cadence: 'fortnightly',
    },
  });
  expect(error).toBeNull();

  const response = data as { circle: { id: string }; invite_secret: string };
  return { circleId: response.circle.id, secret: response.invite_secret };
}

/**
 * Did `claim-identity` actually run for this identity?
 *
 * The honest question, and the reason it has to be asked: on the in-place route
 * **nothing else the test can see depends on the claim**. The membership row's
 * `user_id` never changes, and `is_permanent` is set by the `handle_user_updated`
 * trigger the moment the auth row stops being anonymous. So a regression that
 * skipped the call — exactly what `link.ts` says must never happen — passed the
 * first version of this test, and `mergedMemberships === 0` is also what the
 * early return produces. The audit row is the one artefact only the function
 * writes.
 *
 * Read over psql rather than through the client, because PostgREST exposes only
 * `public` — `070_communication_jobs.sql` asserts that, and `private.audit_log`
 * being unreachable from any client is the same property that makes this row
 * worth asserting on: nothing but the function can write it.
 */
function claimWasRecorded(userId: string): boolean {
  const rows = execFileSync(
    'psql',
    [
      DB_URL,
      '-tAc',
      `select count(*) from private.audit_log
       where action = 'growth.account_claimed' and resource_id = '${userId}'`,
    ],
    { encoding: 'utf8' },
  );
  return Number.parseInt(rows.trim(), 10) > 0;
}

/** An account that already owns an address, so a guest can meet it. */
async function accountFor(address: string): Promise<string> {
  const other = createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'circles.test.other',
    },
  });
  const sent = await other.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: true },
  });
  expect(sent.error).toBeNull();
  const verified = await other.auth.verifyOtp({
    email: address,
    token: await codeFor(MAILPIT, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();
  return verified.data.user?.id ?? '';
}

beforeAll(async () => {
  readStack();

  const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');

  /**
   * `redeem-invite` allows ten redemptions per IP per hour, and every run of
   * this file spends two of them from the same address.
   *
   * Inside `pnpm check` that never bites, because `db:test` resets the database
   * immediately before and the counters go with it. Run on its own a few times
   * — which is what writing it looks like — and the fifth run fails with a 429
   * that has nothing to do with the code under test. Clearing the counters
   * costs nothing here: the limits themselves are covered by pgTAP, and a test
   * that fails for a reason it is not about is worse than no test.
   */
  execFileSync('psql', [DB_URL, '-tAc', 'delete from jobs.rate_counters'], { encoding: 'utf8' });
});

/**
 * A browser that has never been here before.
 *
 * The module owns **one** client and one session, deliberately — two over one
 * storage key is a refresh race. That is right for an app and a trap for a
 * suite: without this, the second test inherited the first test's *permanent*
 * session, `ensureGuestSession()` honoured it rather than signing in anonymously,
 * and the test silently exercised a signed-in user saving their place again.
 * It failed on a count, which is the lucky version; it could as easily have
 * passed and proved nothing.
 */
beforeEach(async () => {
  const { authClient, resetAuthClientForTests } = await import('./client');
  try {
    await authClient().auth.signOut();
  } catch {
    // Nothing signed in, which is the state we are asking for anyway.
  }
  globalThis.localStorage.clear();
  resetAuthClientForTests();
});

describe('a guest who joins a circle and then saves their place', () => {
  it('is still a member afterwards, and is now permanent', async () => {
    const { authClient } = await import('./client');
    const { ensureGuestSession } = await import('./guest');
    const { savePlace } = await import('./link');
    const { requestLinkCode, submitLinkCode } = await import('./providers/email');

    const { circleId, secret } = await circleWithInvite();

    // --- the guest arrives, with no account and no prompts --------------
    const guest = await ensureGuestSession();
    expect(guest.user.is_anonymous).toBe(true);
    const guestId = guest.user.id;

    const joined = await authClient().functions.invoke('redeem-invite', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        secret,
        display_name: 'Nina',
      },
    });
    expect(joined.error).toBeNull();

    // Two members: the owner, who is one by creating the circle, and the guest.
    const before = await authClient()
      .from('circle_members')
      .select('user_id, display_name_snapshot, status')
      .eq('circle_id', circleId);
    expect(before.data?.map((m) => m.user_id)).toContain(guestId);

    // --- and later saves their place with an email code -----------------
    const address = someone('guest');
    const saved = await savePlace({
      moment: 'after_answer',
      signIn: async () => {
        const route = await requestLinkCode(address);
        // A fresh address converts the anonymous user in place.
        expect(route).toBe('new_identity');
        return await submitLinkCode(address, await codeFor(MAILPIT, address), route);
      },
    });

    // The email path converts in place: same id, now permanent. Nothing had to
    // move, which is why `merged_memberships` is zero on this route and why
    // `claim-identity` is still called — see `link.ts`.
    expect(saved.session.user.id).toBe(guestId);
    expect(saved.session.user.is_anonymous).toBeFalsy();
    expect(saved.mergedMemberships).toBe(0);

    // --- the membership survived, which is the whole criterion ----------
    const after = await authClient()
      .from('circle_members')
      .select('user_id, display_name_snapshot, status')
      .eq('circle_id', circleId);
    // The same membership row, under the same name, still active — not a second
    // one created for the permanent identity, which is the failure this guards.
    expect(after.data?.filter((m) => m.user_id === guestId)).toEqual([
      { user_id: guestId, display_name_snapshot: 'Nina', status: 'active' },
    ]);
    expect(after.data).toHaveLength(before.data?.length ?? 0);

    // And the organiser gate will now let them through, which is what saving a
    // place was for (ADR 0004). `is_permanent` is set by `claim-identity`, not
    // by the client.
    const profile = await authClient()
      .from('profiles')
      .select('is_permanent')
      .eq('user_id', guestId)
      .single();
    expect(profile.data?.is_permanent).toBe(true);

    // And the claim genuinely ran, which nothing above could tell us: the
    // trigger sets `is_permanent` on its own, and the membership never moved.
    expect(claimWasRecorded(guestId)).toBe(true);
  });

  it('carries the membership across when the address already has an account', async () => {
    /**
     * The return visit, and the case §10 names `claim-identity` for:
     * "reconcile memberships **if the permanent identity already existed**".
     * Somebody makes an account on their laptop, then answers a plan link on
     * their phone as a guest, then saves their place with the same address.
     *
     * `updateUser({ email })` cannot do this — it refuses with `email_exists`
     * (422) — so the guest simply could not save their place, and this is the
     * only route on which `merged_memberships` is ever non-zero.
     */
    const { authClient } = await import('./client');
    const { ensureGuestSession } = await import('./guest');
    const { savePlace } = await import('./link');
    const { requestLinkCode, submitLinkCode } = await import('./providers/email');

    const { circleId, secret } = await circleWithInvite();

    const address = someone('returning');
    const existingId = await accountFor(address);

    const guest = await ensureGuestSession();
    const guestId = guest.user.id;
    expect(guestId).not.toBe(existingId);

    const joined = await authClient().functions.invoke('redeem-invite', {
      body: { idempotency_key: globalThis.crypto.randomUUID(), secret, display_name: 'Tom' },
    });
    expect(joined.error).toBeNull();

    const saved = await savePlace({
      moment: 'after_answer',
      signIn: async () => {
        const route = await requestLinkCode(address);
        expect(route).toBe('existing_account');
        return await submitLinkCode(address, await codeFor(MAILPIT, address), route);
      },
    });

    // A different identity from the guest's — the one that already existed.
    expect(saved.session.user.id).toBe(existingId);
    expect(saved.mergedMemberships).toBeGreaterThanOrEqual(1);

    // And the membership came with them, under the name they joined as.
    const after = await authClient()
      .from('circle_members')
      .select('user_id, display_name_snapshot, status')
      .eq('circle_id', circleId);
    expect(after.data?.filter((m) => m.user_id === existingId)).toEqual([
      { user_id: existingId, display_name_snapshot: 'Tom', status: 'active' },
    ]);
    expect(after.data?.some((m) => m.user_id === guestId)).toBe(false);
    expect(claimWasRecorded(existingId)).toBe(true);
  });
});

/**
 * How the real auth server says no to a sign-in code, and what the client makes
 * of it.
 *
 * `signIn.test.tsx` covers the screen with `submitSignInCode` mocked to reject
 * with an error the test wrote by hand, which proves the screen reacts to
 * `wrong_code` and nothing about whether Auth ever produces an error that
 * `authFailure` reads that way. These do: the error is whatever GoTrue sent.
 * Break the mapping (drop `otp_expired` or `403` from `authFailure`) and they
 * fail; break the server's behaviour and they fail too, which is the point.
 */
describe('a sign-in code the auth server refuses', () => {
  /** The refusal as the module throws it, or a failed test if it let the code through. */
  async function refusal(attempt: Promise<unknown>): Promise<unknown> {
    try {
      await attempt;
    } catch (error) {
      return error;
    }
    throw new Error('the auth server accepted a code it should have refused');
  }

  /** Six digits that are not `real`, whatever `real` is. */
  const wrongFor = (real: string) => (real === '000000' ? '111111' : '000000');

  it('reads a wrong code as wrong_code', async () => {
    const { authFailure } = await import('../../features/identity/authFailure');
    const { requestSignInCode, submitSignInCode } = await import('./providers/email');

    const address = someone('wrong');
    await requestSignInCode(address);
    const real = await codeFor(MAILPIT, address);

    const error = await refusal(submitSignInCode(address, wrongFor(real)));
    // Auth answers a wrong code exactly as it answers an expired one: 403.
    expect(error).toMatchObject({ status: 403 });
    expect(authFailure(error)).toBe('wrong_code');

    // The refusal did not spend the real code: a typo is not a lockout.
    const signedIn = await submitSignInCode(address, real);
    expect(signedIn.session.user.email).toBe(address);
  });

  it('reads a code past its expiry as wrong_code, the same screen as a typo', async () => {
    const { authFailure } = await import('../../features/identity/authFailure');
    const { requestSignInCode, submitSignInCode } = await import('./providers/email');

    const address = someone('expired');
    await requestSignInCode(address);
    const code = await codeFor(MAILPIT, address);

    // Age it rather than wait: `otp_expiry` is 600 seconds in config.toml. The
    // token row and every `*_sent_at` on the user (which of them the server
    // reads depends on whether the address was new), so the test does not
    // depend on which one it is.
    const aged = sql(
      stack(),
      `with t as (
         update auth.one_time_tokens set created_at = created_at - interval '11 minutes'
         where user_id = (select id from auth.users where email = '${address}') returning 1
       ), u as (
         update auth.users set
           confirmation_sent_at = confirmation_sent_at - interval '11 minutes',
           recovery_sent_at = recovery_sent_at - interval '11 minutes'
         where email = '${address}' returning 1
       ) select (select count(*) from t) || ',' || (select count(*) from u)`,
    );
    expect(aged).toBe('1,1');

    const error = await refusal(submitSignInCode(address, code));
    expect((error as { code?: string }).code).toBe('otp_expired');
    expect(authFailure(error)).toBe('wrong_code');
  });

  it('refuses the first code once a second has been sent', async () => {
    const { authFailure } = await import('../../features/identity/authFailure');
    const { requestSignInCode, submitSignInCode } = await import('./providers/email');

    const address = someone('resend');
    await requestSignInCode(address);
    const first = await codeFor(MAILPIT, address);

    // The auth server will not send twice within `max_frequency` for one user.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await requestSignInCode(address);
    const second = await codeFor(MAILPIT, address, first);
    expect(second).not.toBe(first);

    const error = await refusal(submitSignInCode(address, first));
    expect(authFailure(error)).toBe('wrong_code');

    const signedIn = await submitSignInCode(address, second);
    expect(signedIn.session.user.email).toBe(address);
  });
});
