import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'READ_FROM_SUPABASE_STATUS';
const MAILPIT = 'http://127.0.0.1:54324';

// The module reads these at first use. Set before anything imports the client.
process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;

/** A fresh address per run, so "the newest message to this address" is unambiguous. */
function someone(role: string): string {
  return `${role}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

/**
 * The six-digit code out of Mailpit, the same way `pnpm mail` reads it.
 *
 * Polled rather than read once: the auth server returns before the message has
 * been delivered, and a single read is a race that fails on a loaded machine
 * and passes on a quiet one.
 */
async function codeFor(address: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json()) as {
      messages?: { ID: string; To?: { Address: string }[] }[];
    };
    const match = list.messages?.find((m) => m.To?.some((t) => t.Address === address));
    if (match !== undefined) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      const code = /\b\d{6}\b/.exec(`${full.Text ?? ''}${full.HTML ?? ''}`)?.[0];
      if (code !== undefined) return code;
      throw new Error(
        `No six-digit code for ${address}. If the mail holds a link instead, the ` +
          'magic_link override in supabase/config.toml is not being applied.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No mail for ${address} after 10s. Is the stack up? \`pnpm db:start\``);
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
    token: await codeFor(address),
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
    token: await codeFor(address),
    type: 'email',
  });
  expect(verified.error).toBeNull();
  return verified.data.user?.id ?? '';
}

beforeAll(async () => {
  const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
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
        display_name: 'Priya',
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
        return await submitLinkCode(address, await codeFor(address), route);
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
      { user_id: guestId, display_name_snapshot: 'Priya', status: 'active' },
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
        return await submitLinkCode(address, await codeFor(address), route);
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
  });
});
