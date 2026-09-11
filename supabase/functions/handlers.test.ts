import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three functions themselves, loaded and driven.
 *
 * Until this file existed, nothing in the suite imported a single `index.ts` — only
 * `_shared/*`. Round 11 added an `Unavailable` error so that `claim-identity` could
 * say "nothing was done" instead of stranding an idempotency key, proved the
 * *wrapper* handled it, and never changed the handler. Round 12 found the handler
 * still throwing a bare `Error`. A test of the kit cannot catch that; a test that
 * loads the function can.
 *
 * `Deno.serve` is stubbed to hand the composed handler back rather than to listen,
 * which is the whole trick: each `index.ts` is a module whose only side effect is
 * that one call.
 */

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string) => ({ data: null as unknown, error: null as unknown }),
  /** One entry per `getUser` call, in order: the caller first, then any token a handler checks. */
  users: [] as ({ id: string; is_anonymous: boolean } | { error: { status?: number } })[],
  served: [] as ((request: Request) => Promise<Response>)[],
  fetched: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      return Promise.resolve(state.answer(fn));
    },
    auth: {
      getUser: () => {
        const next = state.users.shift();
        if (next === undefined || 'error' in next) {
          return Promise.resolve({
            data: { user: null },
            error: next?.error ?? { message: 'no', status: 401 },
          });
        }
        return Promise.resolve({ data: { user: next }, error: null });
      },
    },
  }),
}));

(globalThis as { Deno?: unknown }).Deno = {
  env: { get: (key: string) => process.env[key] },
  serve: (handler: (request: Request) => Promise<Response>) => {
    state.served.push(handler);
    return undefined;
  },
};

(globalThis as { fetch?: unknown }).fetch = (url: string) => {
  state.fetched.push(String(url));
  return Promise.resolve(new Response(JSON.stringify({ success: true })));
};

const CALLER = '00000000-0000-4000-8000-00000000000c';
const PREVIOUS = '00000000-0000-4000-8000-00000000000p';
const KEY = '00000000-0000-4000-8000-000000000001';

/**
 * Each module is evaluated once — `Deno.serve` is an import-time side effect, and
 * ESM does not re-run it — so the handlers are collected here and the tests reuse
 * them. They read `state` when they are called, not when they were built, so one
 * instance serves every case.
 */
const handlers = new Map<string, (request: Request) => Promise<Response>>();

async function load(name: string): Promise<(request: Request) => Promise<Response>> {
  const already = handlers.get(name);
  if (already !== undefined) return already;

  state.served = [];
  await import(`./${name}/index.ts`);
  const handler = state.served[0];
  if (handler === undefined) throw new Error(`${name} did not serve a handler`);
  handlers.set(name, handler);
  return handler;
}

function post(body: unknown): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer a.token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const called = (fn: string) => state.rpcs.filter((call) => call.fn === fn);

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  delete process.env.TURNSTILE_SECRET_KEY;
  state.rpcs = [];
  state.fetched = [];
  state.users = [{ id: CALLER, is_anonymous: true }];
  state.answer = (fn) => {
    if (fn === 'begin_request') {
      return {
        data: [{ state: 'fresh', response_status: null, response_body: null }],
        error: null,
      };
    }
    if (fn === 'take_rate_token') return { data: true, error: null };
    return { data: null, error: null };
  };
});

describe('claim-identity', () => {
  const body = {
    idempotency_key: KEY,
    anonymous_session: 'eyJ.old.session',
    moment: 'after_answer' as const,
  };

  it('gives the key back and answers 503 when the auth server cannot be asked', async () => {
    // The finding this exists for: the wrapper grew an `Unavailable` it could place,
    // and the handler went on throwing a bare `Error`. So the claim was kept and the
    // key answered `in_progress` for ever — during a blip, while somebody was trying
    // to save their place.
    state.users = [
      { id: CALLER, is_anonymous: false },
      // A network failure: `supabase-js` returns it in `error`, with no HTTP status.
      { error: { message: 'fetch failed' } as { status?: number } },
    ];

    const handler = await load('claim-identity');
    const response = await handler(post(body));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unavailable' });
    expect(called('release_request')).toHaveLength(1);
    expect(called('claim_identity')).toHaveLength(0);
  });

  it('refuses a caller who has not signed in', async () => {
    state.users = [
      { id: CALLER, is_anonymous: true },
      { id: PREVIOUS, is_anonymous: true },
    ];

    const handler = await load('claim-identity');
    const response = await handler(post(body));

    expect(await response.json()).toMatchObject({ reason: 'destination_is_not_permanent' });
    expect(called('claim_identity')).toHaveLength(0);
  });

  it('merges when the caller has signed in and the old session was a guest', async () => {
    state.users = [
      { id: CALLER, is_anonymous: false },
      { id: PREVIOUS, is_anonymous: true },
    ];
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'claim_identity') {
        return { data: [{ merged_memberships: 1, duplicates_removed: 0 }], error: null };
      }
      return { data: null, error: null };
    };

    const handler = await load('claim-identity');
    const response = await handler(post(body));

    expect(await response.json()).toEqual({
      user_id: CALLER,
      merged_memberships: 1,
      duplicates_removed: 0,
    });
    // The identity it acts on is the one the *token* resolved to, never one the body
    // named — the body has no field for it.
    expect(called('claim_identity')[0]?.args['p_anonymous_user_id']).toBe(PREVIOUS);
  });
});

describe('redeem-invite', () => {
  const body = {
    idempotency_key: KEY,
    secret: 'x'.repeat(43),
    display_name: 'Priya',
  };

  it('sends the digest of the secret, never the secret', async () => {
    const handler = await load('redeem-invite');
    await handler(post(body));

    const sent = called('redeem_invite')[0]?.args['p_secret_hash'];
    expect(sent).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(state.rpcs)).not.toContain(body.secret);
  });

  it('counts the attempt against the link and the address before doing anything', async () => {
    const handler = await load('redeem-invite');
    await handler(post(body));

    const scopes = called('take_rate_token').map((call) => call.args['p_scope']);
    expect(scopes).toEqual(['redeem_invite', 'redeem_ip']);
  });

  it('does not run the guard at all for a retry that was already answered', async () => {
    // Turnstile tokens are single-use, so a replay must not reach it.
    state.answer = (fn) =>
      fn === 'begin_request'
        ? {
            data: [{ state: 'done', response_status: 200, response_body: { circle: null } }],
            error: null,
          }
        : { data: null, error: null };

    const handler = await load('redeem-invite');
    const response = await handler(post(body));

    expect(response.status).toBe(200);
    expect(called('take_rate_token')).toHaveLength(0);
    expect(called('redeem_invite')).toHaveLength(0);
  });
});

describe('reattach-member', () => {
  it('hashes the re-entry token and keys a limit on it', async () => {
    const token = 'y'.repeat(43);
    const handler = await load('reattach-member');
    await handler(post({ idempotency_key: KEY, reentry_token: token }));

    const args = called('reattach_member')[0]?.args ?? {};
    expect(args['p_reentry_token_hash']).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(state.rpcs)).not.toContain(token);

    const scopes = called('take_rate_token').map((call) => call.args['p_scope']);
    expect(scopes).toContain('reattach_token');
    // No circle to count against: it is inside the token, where only the database
    // can read it.
    expect(scopes).not.toContain('reattach_circle');
  });

  it('counts against the circle when the membership was chosen from the list', async () => {
    const handler = await load('reattach-member');
    await handler(
      post({
        idempotency_key: KEY,
        circle_id: '00000000-0000-4000-8000-0000000000c1',
        target_member_user_id: '00000000-0000-4000-8000-0000000000a1',
      }),
    );

    const scopes = called('take_rate_token').map((call) => call.args['p_scope']);
    expect(scopes).toEqual(['reattach_ip', 'reattach_circle']);
  });

  it('refuses a request that names both a membership and a token', async () => {
    const handler = await load('reattach-member');
    const response = await handler(
      post({
        idempotency_key: KEY,
        circle_id: '00000000-0000-4000-8000-0000000000c1',
        target_member_user_id: '00000000-0000-4000-8000-0000000000a1',
        reentry_token: 'y'.repeat(43),
      }),
    );

    expect(response.status).toBe(400);
    expect(called('reattach_member')).toHaveLength(0);
  });
});
