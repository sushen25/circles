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
  /** Every token `getUser` was actually given — the mock used to ignore its argument. */
  tokens: [] as string[],
  /** What a `from(table).select(...)` answers, by table. */
  rows: {} as Record<string, unknown>,
  /** Rows a `count: 'exact'` head request reports. */
  counts: {} as Record<string, number>,
  /** Every table read, so a handler that reads through the service client is visible. */
  reads: [] as string[],
  served: [] as ((request: Request) => Promise<Response>)[],
  fetched: [] as string[],
}));

/**
 * `_shared/db.ts` is mocked, not `@supabase/supabase-js`.
 *
 * Mocking the package worked when this project ran alone and silently did not when
 * the whole workspace did — `apps/app` depends on the same package, and whichever
 * specifier the mock registered was not the one `db.ts` resolved. The real `getUser`
 * then went to the network, and `AuthRetryableFetchError`'s backoff took fifty
 * seconds per test and starved two unrelated property-based suites into timing out.
 *
 * Our own module has one resolution and no network, so this cannot drift.
 */
const client = vi.hoisted(() => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    state.rpcs.push({ fn, args });
    return Promise.resolve(state.answer(fn));
  },
  /**
   * Just enough of PostgREST's builder to be chained and awaited.
   *
   * Every method returns the builder and the builder is thenable, which is what
   * makes `.select(…).eq(…).eq(…)` and `.select(…).eq(…).maybeSingle()` both
   * work without modelling a query. An earlier version returned a promise from
   * `select` when a count was asked for, and the next `.eq()` in the chain found
   * a promise with no such method — so four handlers answered 500 and three
   * tests were asserting against it.
   */
  from: (table: string) => {
    state.reads.push(table);
    let counting = false;
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        resolve(
          counting
            ? { count: state.counts[table] ?? 0, data: null, error: null }
            : { data: state.rows[table] ?? null, error: null },
        ),
      maybeSingle: () => Promise.resolve({ data: state.rows[table] ?? null, error: null }),
    };
    builder['single'] = builder['maybeSingle'];
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
      builder[method] = (_first?: unknown, options?: { head?: boolean }): unknown => {
        if (options?.head === true) counting = true;
        return builder;
      };
    }
    return builder;
  },
  auth: {
    getUser: (token: string) => {
      state.tokens.push(token);
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
}));

vi.mock('./_shared/db.ts', () => ({
  asCaller: () => client,
  asService: () => client,
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

/**
 * A circle as the row comes back. Not `null`: answering `null` made `circleDto`
 * throw, so the handler returned 500 and six of these tests passed anyway — each
 * asserted which RPCs were called and never looked at the response. A real-shaped
 * row is also the only thing in the repo that exercises `circleDto` at all.
 */
const CIRCLE_ROW = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Sunday Crew',
  color: 'sky',
  time_zone: 'Australia/Melbourne',
  cadence: 'fortnightly',
  short_code: 'jmhzcew29t',
  status: 'active',
  last_met_at: null,
  // Columns a DTO must not carry through (§7.4: "never the raw row").
  owner_user_id: '00000000-0000-4000-8000-000000000001',
  creation_key: 'secret-key',
  default_quorum: 3,
};

const CALLER = '00000000-0000-4000-8000-00000000000c';
const PREVIOUS = '00000000-0000-4000-8000-00000000000p';
const KEY = '00000000-0000-4000-8000-000000000001';

/**
 * Loaded at module scope, before any test runs.
 *
 * Importing a handler pulls in `@circles/contracts` and `@circles/domain` through the
 * aliases, which under a whole-workspace run costs more than a test's five-second
 * budget — so the *first* test timed out, and the one after it inherited a half-shifted
 * queue and failed for a reason that had nothing to do with it. Top-level `await` is
 * outside that budget, and it makes the order of the tests irrelevant.
 *
 * Each module is evaluated once in any case: `Deno.serve` is an import-time side
 * effect and ESM does not re-run it. The handlers read `state` when they are called,
 * not when they were built, so one instance serves every case.
 */
async function serveOf(name: string): Promise<(request: Request) => Promise<Response>> {
  state.served = [];
  await import(`./${name}/index.ts`);
  const handler = state.served[0];
  if (handler === undefined) throw new Error(`${name} did not serve a handler`);
  return handler;
}

const handlers = {
  'claim-identity': await serveOf('claim-identity'),
  'redeem-invite': await serveOf('redeem-invite'),
  'reattach-member': await serveOf('reattach-member'),
  'create-circle': await serveOf('create-circle'),
  'create-plan': await serveOf('create-plan'),
  'revise-plan': await serveOf('revise-plan'),
  'cancel-plan': await serveOf('cancel-plan'),
};

function load(name: keyof typeof handlers): (request: Request) => Promise<Response> {
  return handlers[name];
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
  state.tokens = [];
  state.reads = [];
  state.rows = {};
  state.counts = {};
  state.users = [{ id: CALLER, is_anonymous: true }];
  state.answer = (fn) => {
    if (fn === 'begin_request') {
      return {
        data: [{ state: 'fresh', response_status: null, response_body: null }],
        error: null,
      };
    }
    if (fn === 'take_rate_token') return { data: true, error: null };
    if (fn === 'redeem_invite' || fn === 'reattach_member') {
      return { data: CIRCLE_ROW, error: null };
    }
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

    const handler = load('claim-identity');
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

    const handler = load('claim-identity');
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

    const handler = load('claim-identity');
    const response = await handler(post(body));

    expect(await response.json()).toEqual({
      user_id: CALLER,
      merged_memberships: 1,
      duplicates_removed: 0,
    });
    // The identity it acts on is the one the *token* resolved to, never one the body
    // named — the body has no field for it. Asserted against the token the mock was
    // actually handed, because the mock used to ignore its argument: pointing the
    // handler at an entirely different token passed nine out of nine.
    expect(state.tokens[0]).toBe('a.token');
    expect(state.tokens[1]).toBe(body.anonymous_session);
    expect(called('claim_identity')[0]?.args['p_anonymous_user_id']).toBe(PREVIOUS);
  });
});

describe('redeem-invite', () => {
  const body = {
    idempotency_key: KEY,
    secret: 'x'.repeat(43),
    display_name: 'Priya',
  };

  it('joins, and answers with a DTO rather than the row', async () => {
    const handler = load('redeem-invite');
    const response = await handler(post(body));

    expect(response.status).toBe(200);
    const answered = (await response.json()) as { circle: Record<string, unknown> };
    expect(answered.circle['name']).toBe('Sunday Crew');
    // §7.4: "Return a DTO; never the raw row."
    expect(answered.circle).not.toHaveProperty('owner_user_id');
    expect(answered.circle).not.toHaveProperty('creation_key');
    expect(answered.circle).not.toHaveProperty('default_quorum');
  });

  it('sends the digest of the secret, never the secret', async () => {
    const handler = load('redeem-invite');
    expect((await handler(post(body))).status).toBe(200);

    const sent = called('redeem_invite')[0]?.args['p_secret_hash'];
    expect(sent).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(state.rpcs)).not.toContain(body.secret);
  });

  it('counts the attempt against the link and the address before doing anything', async () => {
    const handler = load('redeem-invite');
    expect((await handler(post(body))).status).toBe(200);

    // Sorted: `enforce` runs the limits with `Promise.all` and each awaits its own
    // digest first, so which RPC lands first is a race. Asserting the order would be
    // asserting something the code never promised — and it failed about one run in
    // three, which is worse than not testing it.
    const scopes = called('take_rate_token').map((call) => call.args['p_scope']);
    expect(scopes.sort()).toEqual(['redeem_invite', 'redeem_ip']);
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

    const handler = load('redeem-invite');
    const response = await handler(post(body));

    expect(response.status).toBe(200);
    expect(called('take_rate_token')).toHaveLength(0);
    expect(called('redeem_invite')).toHaveLength(0);
  });
});

describe('reattach-member', () => {
  it('hashes the re-entry token and keys a limit on it', async () => {
    const token = 'y'.repeat(43);
    const handler = load('reattach-member');
    expect((await handler(post({ idempotency_key: KEY, reentry_token: token }))).status).toBe(200);

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
    const handler = load('reattach-member');
    const answered = await handler(
      post({
        idempotency_key: KEY,
        circle_id: '00000000-0000-4000-8000-0000000000c1',
        target_member_user_id: '00000000-0000-4000-8000-0000000000a1',
      }),
    );
    expect(answered.status).toBe(200);

    const scopes = called('take_rate_token').map((call) => call.args['p_scope']);
    expect(scopes.sort()).toEqual(['reattach_circle', 'reattach_ip']);
  });

  it('refuses a request that names both a membership and a token', async () => {
    const handler = load('reattach-member');
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

const CIRCLE_ID = '00000000-0000-4000-8000-0000000000c1';
const PLAN_ID = '00000000-0000-4000-8000-0000000000p1'.replace('p', 'e');

describe('create-circle', () => {
  const body = {
    idempotency_key: KEY,
    name: 'Sunday Crew',
    color: 'sky',
    time_zone: 'Australia/Melbourne',
    cadence: 'fortnightly' as const,
  };

  beforeEach(() => {
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'create_circle') return { data: CIRCLE_ROW, error: null };
      return { data: null, error: null };
    };
  });

  it('refuses a guest with the reason that opens InitiateGate', async () => {
    // Not a generic forbidden: `requires_saved_place` is what tells the client to
    // offer sign-in rather than show a failure (ADR 0004).
    state.users = [{ id: CALLER, is_anonymous: true }];

    const response = await load('create-circle')(post(body));

    expect(await response.json()).toMatchObject({ reason: 'requires_saved_place' });
    expect(called('create_circle')).toHaveLength(0);
  });

  it('makes the circle and its first link', async () => {
    state.users = [{ id: CALLER, is_anonymous: false }];

    const response = await load('create-circle')(post(body));
    const answered = (await response.json()) as { invite_secret: string; circle: object };

    expect(response.status).toBe(200);
    // One call, so there is no moment at which the circle exists without the
    // link the same request promised: a failure between two RPCs left a circle
    // nobody could be invited to and a person reading an error.
    expect(called('create_circle')).toHaveLength(1);
    expect(called('issue_invite')).toHaveLength(0);
    expect(called('create_circle')[0]?.args['invite_secret_hash']).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(answered.circle).not.toHaveProperty('creation_key');
  });

  it('gives the database the digest and never the secret', async () => {
    // §14 puts the secret in the fragment, which no server sees, and stores only
    // its SHA-256. So it must not be a statement parameter anywhere.
    state.users = [{ id: CALLER, is_anonymous: false }];

    const response = await load('create-circle')(post(body));
    const { invite_secret: secret } = (await response.json()) as { invite_secret: string };

    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(called('create_circle')[0]?.args['invite_secret_hash']).toMatch(/^\\x[0-9a-f]{64}$/);

    const toTheProduct = [...called('issue_invite'), ...called('create_circle')];
    expect(JSON.stringify(toTheProduct)).not.toContain(secret);
  });

  it('does keep it in the idempotency record, which is the point of one', async () => {
    // The deliberate exception, asserted so that it is a decision rather than an
    // oversight: a retry whose first attempt was lost has to come back with the
    // *same* link. The record lives in `jobs`, which no client role can read, and
    // retention sweeps it after seven days.
    state.users = [{ id: CALLER, is_anonymous: false }];

    const response = await load('create-circle')(post(body));
    const { invite_secret: secret } = (await response.json()) as { invite_secret: string };

    expect(JSON.stringify(called('finish_request'))).toContain(secret);
  });

  it('gives a different secret every time', async () => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    const first = (await (await load('create-circle')(post(body))).json()) as {
      invite_secret: string;
    };
    state.users = [{ id: CALLER, is_anonymous: false }];
    const second = (await (await load('create-circle')(post(body))).json()) as {
      invite_secret: string;
    };
    expect(first.invite_secret).not.toBe(second.invite_secret);
  });
});

describe('create-plan', () => {
  const body = {
    idempotency_key: KEY,
    circle_id: CIRCLE_ID,
    title: 'Catch up',
    preset: 'next_14_days' as const,
  };

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rows = {
      circles: {
        time_zone: 'Australia/Melbourne',
        status: 'active',
        default_duration_minutes: 120,
        default_quorum: null,
      },
    };
    state.counts = { circle_members: 6 };
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'create_plan') {
        return { data: { id: PLAN_ID, short_code: 'jmhzcew2', quorum: 4 }, error: null };
      }
      return { data: null, error: null };
    };
  });

  it('refuses a guest with the reason that opens InitiateGate', async () => {
    // The state machine refuses this too, but it says `needs_permanent_identity`
    // — not a `ProblemReason` — so the client got a 500 and no way to know it
    // should offer sign-in (ADR 0004).
    state.users = [{ id: CALLER, is_anonymous: true }];

    const response = await load('create-plan')(post(body));

    expect(await response.json()).toMatchObject({ reason: 'requires_saved_place' });
    expect(called('create_plan')).toHaveLength(0);
  });

  it('refuses a quorum of one before it reaches a check constraint', async () => {
    // `plans_quorum` would raise 23514, whose SQLSTATE maps to no reason — so an
    // ordinary invalid request came back as a 500.
    const response = await load('create-plan')(post({ ...body, quorum: 1 }));

    expect(response.status).toBe(400);
    expect(called('create_plan')).toHaveLength(0);
  });

  it('refuses a quiet ask as not-yet rather than as a failure', async () => {
    const response = await load('create-plan')(post({ ...body, mode: 'quiet' }));

    expect(await response.json()).toMatchObject({ reason: 'not_yet' });
    expect(called('create_plan')).toHaveLength(0);
  });

  it('resolves the preset and the defaults, and sends what they resolved to', async () => {
    // The numbers a screen must never compute: the window from `resolvePreset`,
    // the deadline from `defaultDeadline`, the quorum from `quorumDefault(6)`.
    const response = await load('create-plan')(post(body));
    const sent = called('create_plan')[0]?.args ?? {};

    expect(response.status).toBe(200);
    expect(sent['p_window_start']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent['p_duration_minutes']).toBe(120);
    // max(2, ceil(6 × 0.6)) = 4.
    expect(sent['p_quorum']).toBe(4);
    expect(sent['p_response_deadline']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes the domain’s own word for a window that cannot be', async () => {
    // `custom` with no dates is `window_backwards`, and the reason travels
    // unchanged so a reader can find the rule that produced it.
    const response = await load('create-plan')(post({ ...body, preset: 'custom' }));

    expect(await response.json()).toMatchObject({ reason: 'window_backwards' });
    expect(called('create_plan')).toHaveLength(0);
  });

  it('refuses a deadline after the last possible start', async () => {
    const response = await load('create-plan')(
      post({ ...body, response_deadline: '2099-12-31T00:00:00Z' }),
    );

    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
  });

  it('will not plan in an archived circle', async () => {
    state.rows = {
      circles: {
        time_zone: 'Australia/Melbourne',
        status: 'archived',
        default_duration_minutes: 120,
        default_quorum: null,
      },
    };

    const response = await load('create-plan')(post(body));
    expect(await response.json()).toMatchObject({ reason: 'circle_archived' });
  });
});

describe('revise-plan', () => {
  const current = {
    window_start: '2099-09-17',
    window_end: '2099-09-20',
    daily_start_local: 1050,
    daily_end_local: 1350,
    duration_minutes: 120,
    time_zone: 'Australia/Melbourne',
    quorum: 3,
    response_deadline: '2099-09-16T10:00:00.000Z',
    revision: 1,
    input_version: 7,
    state: 'collecting',
  };

  // A reopen is only a reopen from `confirmed`, which the mirror in
  // `packages/domain` is now asked about before anything else happens.
  const confirmed = (): void => {
    state.rows = { ...state.rows, plans: { ...current, state: 'confirmed' } };
  };

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    // Maya has to be there, which is `create_plan`'s default.
    state.rows = {
      plans: current,
      plan_required_members: [{ user_id: '00000000-0000-4000-8000-0000000000a1' }],
      plan_participants: [
        { user_id: '00000000-0000-4000-8000-0000000000a1' },
        { user_id: '00000000-0000-4000-8000-0000000000a2' },
      ],
    };
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'reask_audience') {
        return {
          data: [
            { member_user_id: '00000000-0000-4000-8000-0000000000a1', has_responded: true },
            { member_user_id: '00000000-0000-4000-8000-0000000000a2', has_responded: false },
          ],
          error: null,
        };
      }
      if (fn === 'revise_plan') {
        // The plan *and* the audience it had, derived under the same lock. The
        // audience deliberately differs from `reask_audience`'s above: a save
        // that still used that one would report the stale answer.
        return {
          data: {
            plan: { revision: 2 },
            version: '1.4',
            audience: [
              { member_user_id: '00000000-0000-4000-8000-0000000000a1', has_responded: true },
              { member_user_id: '00000000-0000-4000-8000-0000000000a2', has_responded: true },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('answers the warning without saving anything', async () => {
    // Spec §5.3: the organiser sees the cost *before* paying it.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        preview: true,
      }),
    );
    const answer = (await response.json()) as { asked_again: string[]; bumps_revision: boolean };

    expect(answer.asked_again).toEqual(['00000000-0000-4000-8000-0000000000a1']);
    expect(answer.bumps_revision).toBe(true);
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('costs nobody a reply when only the quorum moves', async () => {
    const response = await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 4 }),
    );
    const answer = (await response.json()) as { asked_again: string[]; bumps_revision: boolean };

    expect(answer.asked_again).toEqual([]);
    expect(answer.bumps_revision).toBe(false);
    expect(called('revise_plan')[0]?.args['p_payload']).toEqual({ quorum: 4 });
  });

  it('does not send a window that has not changed', async () => {
    // Re-sending the current window would make `revise_plan` call it an `edit`,
    // bump a revision and clear every answer — over a no-op.
    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: current.window_start, end: current.window_end },
        quorum: 5,
      }),
    );

    expect(called('revise_plan')[0]?.args['p_payload']).toEqual({ quorum: 5 });
  });

  it('passes a changed required-member list through', async () => {
    // Spec §9's answer to "a required person leaves" is that the organiser
    // changes them — and until this there was no way to.
    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        required_member_ids: ['00000000-0000-4000-8000-0000000000a2'],
      }),
    );

    expect(called('revise_plan')[0]?.args['p_required_member_ids']).toEqual([
      '00000000-0000-4000-8000-0000000000a2',
    ]);
  });

  it('distinguishes "leave them alone" from "nobody is required"', async () => {
    await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 4 }));
    expect(called('revise_plan')[0]?.args['p_required_member_ids']).toBeNull();

    // A second request needs a second identification: the mock's queue is
    // consumed, and an empty one is a rejected caller rather than this caller.
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rpcs = [];
    await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, required_member_ids: [] }),
    );
    // Spec §9: "nobody is required" is how an ineligible plan is unstuck, so an
    // empty list is an instruction and not an absence.
    expect(called('revise_plan')[0]?.args['p_required_member_ids']).toEqual([]);
  });

  it('does not rewrite a required list that came back unchanged', async () => {
    // An edit form shows who has to be there and sends them back. Rewriting the
    // identical rows bumps `input_version`, says the plan changed and drops a
    // ready plan to collecting — over a form nobody edited. Order is not a
    // change either, so the comparison is of sets.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        required_member_ids: ['00000000-0000-4000-8000-0000000000a1'],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'nothing_to_change' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('names everybody a reopen will ask again', async () => {
    confirmed();
    // "Thursday is off the table" and "a fresh ask" (spec §5.7). A reopen
    // changes no timing, so the comparison found nothing and the warning named
    // nobody — while the revision bump cleared every answer there was.
    const response = await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, reopen: true }),
    );
    const answer = (await response.json()) as { asked_again: string[]; bumps_revision: boolean };

    expect(answer.asked_again).toEqual([
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a2',
    ]);
    expect(answer.bumps_revision).toBe(true);
  });

  it('separates the fresh ask from the second ask when previewing a reopen', async () => {
    confirmed();
    const response = await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, reopen: true, preview: true }),
    );
    const answer = (await response.json()) as { asked_again: string[]; fresh_ask: string[] };

    expect(answer.asked_again).toEqual(['00000000-0000-4000-8000-0000000000a1']);
    expect(answer.fresh_ask).toEqual(['00000000-0000-4000-8000-0000000000a2']);
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('refuses a form resubmitted with the values the plan already has', async () => {
    // Sent, not changed. A `quorum` key on a plan whose quorum is already that
    // emits "the plan changed", bumps `input_version` and drops a ready plan
    // back to collecting — over a form nobody edited.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        quorum: current.quorum,
        response_deadline: current.response_deadline,
        window: { start: current.window_start, end: current.window_end },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'nothing_to_change' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('does not refuse a deadline that has passed when it is not the thing changing', async () => {
    // §5.7 offers "give it one more day" *after* replies close, so a plan whose
    // deadline has gone is exactly the plan an organiser needs to edit.
    state.rows = { plans: { ...current, response_deadline: '2020-01-01T00:00:00.000Z' } };

    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        response_deadline: '2020-01-01T00:00:00.000Z',
        quorum: 5,
      }),
    );

    expect(called('revise_plan')[0]?.args['p_payload']).toEqual({ quorum: 5 });
  });

  it('asks for a reopen by name rather than by inference', async () => {
    confirmed();
    await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID, reopen: true }));

    expect(called('revise_plan')[0]?.args['p_reopen']).toBe(true);
  });

  it('reports the audience the save saw, not the one a preview would have', async () => {
    // An answer landing between the two calls was cleared by the revision bump
    // and then named as somebody who had never answered — the warning wrong
    // about exactly the person it was most about. `revise_plan` reads the
    // audience under the plan's lock and returns it, so there is no between.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
      }),
    );
    const answer = (await response.json()) as { asked_again: string[]; fresh_ask: string[] };

    expect(answer.asked_again).toEqual([
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a2',
    ]);
    expect(answer.fresh_ask).toEqual([]);
    // And the round trip that opened the gap is not made at all.
    expect(called('reask_audience')).toHaveLength(0);
  });

  it('refuses a deadline that has already passed', async () => {
    // "Editable, never after the last possible start" (spec §5.3) has two ends,
    // and a deadline in the past closes replies the instant it is saved.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        response_deadline: '2020-01-01T00:00:00.000Z',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('refuses a deadline after the last possible start', async () => {
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        response_deadline: '2099-10-01T00:00:00.000Z',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
  });

  it('judges the deadline against the window the request is setting', async () => {
    // Both move in one request: the deadline is fine for the window the plan
    // has and past the end of the one it is being given. Judged against the old
    // one it would have been saved, and replies would have closed after the
    // meetup could no longer start.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        response_deadline: '2099-09-19T10:00:00.000Z',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('refuses a duration the evening cannot hold', async () => {
    // `plans_band_fits` refused this with a constraint the client cannot read,
    // so an ordinary mistake was a 500 and the preview said it was fine.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        daily: { startMin: 1050, endMin: 1170 },
        duration_minutes: 180,
        preview: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'band_shorter_than_meetup' });
  });

  it('refuses a window that no longer leaves room for the deadline it keeps', async () => {
    // Shortening a window moves the last possible start earlier, so a deadline
    // nobody touched ends up after it. The plan's own deadline is 16 September;
    // a window ending on the 15th puts it past the last moment the meetup could
    // begin, and replies would close after the plan could no longer happen.
    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-14', end: '2099-09-15' },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('will not reopen a plan into a deadline that has passed', async () => {
    // A reopen is a fresh ask (spec §5.7), and `replace_response` refuses every
    // reply once the deadline is behind us — so this reopened the plan, told
    // everybody, and left them unable to answer.
    state.rows = {
      ...state.rows,
      plans: { ...current, state: 'confirmed', response_deadline: '2020-01-01T00:00:00.000Z' },
    };

    const response = await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, reopen: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('reopens it once the organiser says when replies close', async () => {
    state.rows = {
      ...state.rows,
      plans: { ...current, state: 'confirmed', response_deadline: '2020-01-01T00:00:00.000Z' },
    };

    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        reopen: true,
        response_deadline: '2099-09-18T10:00:00.000Z',
      }),
    );

    expect(called('revise_plan')[0]?.args['p_payload']).toEqual({
      response_deadline: '2099-09-18T10:00:00.000Z',
    });
  });

  it('will not start a revision into a deadline that has passed', async () => {
    // A new revision is a fresh ask of the same people (spec §5.3), and
    // `replace_response` refuses every reply once the deadline is behind us —
    // so this cleared the answers, asked again, and let nobody answer.
    state.rows = {
      ...state.rows,
      plans: { ...current, response_deadline: '2020-01-01T00:00:00.000Z' },
    };

    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-19' },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'deadline_out_of_range' });
    expect(called('revise_plan')).toHaveLength(0);
  });

  it('leaves a passed deadline alone for an edit that asks nobody again', async () => {
    // §5.7's "give it one more day" is for exactly this plan, and a quorum is
    // not a new question.
    state.rows = {
      ...state.rows,
      plans: { ...current, response_deadline: '2020-01-01T00:00:00.000Z' },
    };

    await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 5 }));

    expect(called('revise_plan')[0]?.args['p_payload']).toEqual({ quorum: 5 });
  });

  it('refuses to preview what it would refuse to save', async () => {
    // A preview is a promise about what saving would do. Editing a confirmed
    // plan without reopening previewed as fine and then failed on save with
    // `wrong_state`, which is a warning about an edit that was never possible.
    state.rows = { ...state.rows, plans: { ...current, state: 'confirmed' } };

    const response = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        preview: true,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'wrong_state' });
    expect(called('reask_audience')).toHaveLength(0);
  });

  it('says a finished plan is finished rather than out of order', async () => {
    state.rows = { ...state.rows, plans: { ...current, state: 'cancelled' } };

    const response = await load('revise-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 5 }),
    );

    expect(await response.json()).toMatchObject({ reason: 'plan_is_finished' });
  });

  it('hands back the version its warning was about', async () => {
    // And the save sends it on, so a plan that moved between the two is refused
    // rather than costing somebody more than they were shown (spec §5.3).
    const preview = await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        preview: true,
      }),
    );
    expect(await preview.json()).toMatchObject({ version: '1.7' });

    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rpcs = [];
    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        expected_version: '1.7',
      }),
    );
    expect(called('revise_plan')[0]?.args['p_expected_version']).toBe('1.7');
  });

  it('sends no version the caller did not offer', async () => {
    await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 5 }));
    expect(called('revise_plan')[0]?.args['p_expected_version']).toBeNull();
  });

  it('refuses an edit that changes nothing', async () => {
    const response = await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID }));
    expect(response.status).toBe(400);
    expect(called('revise_plan')).toHaveLength(0);
  });
});

describe('cancel-plan', () => {
  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
  });

  it('carries the note to the row', async () => {
    const response = await load('cancel-plan')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, note: 'Something came up' }),
    );

    expect(response.status).toBe(200);
    expect(called('cancel_plan')[0]?.args['p_note']).toBe('Something came up');
  });

  it('sends null rather than an empty note', async () => {
    await load('cancel-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID }));
    expect(called('cancel_plan')[0]?.args['p_note']).toBeNull();
  });
});
