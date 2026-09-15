import { CONSENT } from '@circles/config';
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
  /** Every write that goes through a policy rather than a function. */
  writes: [] as { table: string; method: string; values?: unknown }[],
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
    // The write half. Absent, these threw "not a function" — and the test of the
    // one handler that writes through a policy rather than a function passed
    // anyway, because it asserted which RPCs were *not* called and never looked
    // at the response. Recorded rather than swallowed, so a test can say what
    // was written and to where.
    for (const method of ['insert', 'update', 'upsert', 'delete']) {
      builder[method] = (values?: unknown): unknown => {
        state.writes.push({ table, method, values });
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
  'submit-availability': await serveOf('submit-availability'),
  'recalculate-candidates': await serveOf('recalculate-candidates'),
  'confirm-meetup': await serveOf('confirm-meetup'),
  'report-outcome': await serveOf('report-outcome'),
  'generate-ics': await serveOf('generate-ics'),
  'request-email-updates': await serveOf('request-email-updates'),
  'verify-email-contact': await serveOf('verify-email-contact'),
  'manage-email-preferences': await serveOf('manage-email-preferences'),
  'track-events': await serveOf('track-events'),
};

function load(name: keyof typeof handlers): (request: Request) => Promise<Response> {
  return handlers[name];
}

function post(body: unknown, bearer = 'a.token'): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A link in an email is opened by somebody with no session at all. */
function postWithoutSession(body: unknown): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** `generate-ics` is a GET: a browser has to be able to navigate to a download. */
function get(query: Record<string, string>): Request {
  const url = new URL('https://example.test/fn');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, { headers: { authorization: 'Bearer a.token' } });
}

const called = (fn: string) => state.rpcs.filter((call) => call.fn === fn);

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.CRON_SECRET;
  state.rpcs = [];
  state.fetched = [];
  state.tokens = [];
  state.reads = [];
  state.writes = [];
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
      // A save stales the set — a quorum change, a new required member, a new
      // revision — so it recalculates, the way an answer does (ADR 0018).
      if (fn === 'engine_input') {
        return {
          data: {
            plan: {
              id: PLAN_ID,
              circle_id: CIRCLE_ID,
              state: 'collecting',
              revision: 1,
              input_version: 7,
              scoring_version: 1,
              time_zone: 'Australia/Melbourne',
              window_start: '2099-09-17',
              window_end: '2099-09-20',
              daily_start_local: 1050,
              daily_end_local: 1350,
              duration_minutes: 120,
              quorum: 3,
              required_member_ids: [],
            },
            active_member_ids: [],
            responses: [],
          },
          error: null,
        };
      }
      if (fn === 'store_candidate_set') {
        return {
          data: {
            stored: true,
            state: 'collecting',
            eligible: 0,
            near_misses: 0,
            input_version: 8,
          },
          error: null,
        };
      }
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

  it('recalculates after a save, because an adjustment stales the set', async () => {
    // Spec §5.6 offers "lower the quorum" on the no-quorum screen, and nothing
    // else would have recalculated until somebody answered — so the action the
    // screen offers would have changed nothing on it.
    await load('revise-plan')(post({ idempotency_key: KEY, plan_id: PLAN_ID, quorum: 5 }));

    expect(called('engine_input')).toHaveLength(1);
  });

  it('does not recalculate for a preview, which changes nothing', async () => {
    await load('revise-plan')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        window: { start: '2099-09-17', end: '2099-09-18' },
        preview: true,
      }),
    );

    expect(called('engine_input')).toHaveLength(0);
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

describe('submit-availability', () => {
  const plan = {
    window_start: '2099-09-17',
    window_end: '2099-09-20',
    daily_start_local: 1050,
    daily_end_local: 1350,
    duration_minutes: 120,
    time_zone: 'Australia/Melbourne',
  };

  /**
   * 19:00–20:00 Melbourne on the 17th, as instants. What a painted 18:37–20:22
   * becomes: rounding is **inward**, because a window is a claim about when
   * somebody is genuinely free and the safe error is to claim less.
   */
  const roundedInward = { start: '2099-09-17T09:00:00.000Z', end: '2099-09-17T10:00:00.000Z' };

  const summary = {
    stored: true,
    candidate_set_id: '00000000-0000-4000-8000-0000000000e1',
    state: 'ready',
    eligible: 4,
    near_misses: 0,
    input_version: 7,
  };

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rows = { plans: { ...plan, revision: 1 } };
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'replace_response') {
        return { data: { id: '00000000-0000-4000-8000-0000000000r1', revision: 1 }, error: null };
      }
      if (fn === 'engine_input') {
        return {
          data: {
            plan: {
              id: PLAN_ID,
              circle_id: '00000000-0000-4000-8000-0000000000c1',
              state: 'collecting',
              revision: 1,
              input_version: 7,
              scoring_version: 1,
              required_member_ids: [],
              ...plan,
              quorum: 2,
            },
            active_member_ids: [CALLER],
            responses: [],
          },
          error: null,
        };
      }
      if (fn === 'store_candidate_set') return { data: summary, error: null };
      return { data: null, error: null };
    };
  });

  it('normalises what was painted before storing it', async () => {
    // A finger on a touch screen produces 18:37–20:22, and what is stored is
    // 19:00–20:00: rounding outward would invent availability nobody offered,
    // and the cost of that is a meetup somebody cannot actually attend. The
    // database refuses an unaligned window outright, so this is also the
    // difference between an answer and a 500.
    await load('submit-availability')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-09-17T08:37:00.000Z', end: '2099-09-17T10:22:00.000Z' }],
      }),
    );

    expect(called('replace_response')[0]?.args['p_windows']).toEqual([roundedInward]);
  });

  it('refuses a window on a date the plan never mentions', async () => {
    // Not dropped. A caller and a plan disagreeing about what was asked is worth
    // saying out loud; an answer that quietly lost half of what somebody painted
    // is not.
    const response = await load('submit-availability')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-10-01T08:30:00.000Z', end: '2099-10-01T10:30:00.000Z' }],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'outside_plan_window' });
    expect(called('replace_response')).toHaveLength(0);
  });

  it('refuses a windows answer whose windows all aligned away', async () => {
    // Ten minutes inside the band is a stray tap: the domain drops it rather
    // than calling it an error, which leaves a `windows` answer carrying none.
    const response = await load('submit-availability')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-09-17T08:35:00.000Z', end: '2099-09-17T08:45:00.000Z' }],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'windows_do_not_match_status' });
    expect(called('replace_response')).toHaveLength(0);
  });

  it('tells an offline draft the question changed, not that its windows are wrong', async () => {
    // A draft survives going offline (spec §5.5) and comes back addressed to
    // the revision the person was shown. If the organiser has moved the dates
    // since, normalising first judges yesterday's windows against today's
    // window and calls them malformed — when what the client needs to hear is
    // "fetch the plan and ask again".
    state.rows = { plans: { ...plan, revision: 2 } };

    const response = await load('submit-availability')(
      post({
        idempotency_key: KEY,
        plan_id: PLAN_ID,
        revision: 1,
        status: 'windows',
        windows: [{ start: '2099-09-17T08:30:00.000Z', end: '2099-09-17T10:30:00.000Z' }],
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'stale_revision' });
    expect(called('replace_response')).toHaveLength(0);
  });

  it('sends the revision being answered, not the one the plan is at', async () => {
    // An answer is an answer to a question, and the question can change while a
    // draft sits on a phone with no signal. `replace_response` is what refuses a
    // stale one; the handler's job is to pass on what the person was actually
    // shown.
    state.rows = { plans: { ...plan, revision: 3 } };

    await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 3, status: 'flexible' }),
    );

    expect(called('replace_response')[0]?.args['p_revision']).toBe(3);
    expect(called('replace_response')[0]?.args['p_status']).toBe('flexible');
    expect(called('replace_response')[0]?.args['p_windows']).toEqual([]);
  });

  it('runs the engine in the same request and answers with what it found', async () => {
    // Architecture §9.1 puts the recalculation inline: the alternative is a
    // screen that says "thanks" and shows nothing until a scheduled job catches
    // up a minute later.
    const response = await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    expect(called('engine_input')).toHaveLength(1);
    expect(await response.json()).toMatchObject({
      revision: 1,
      candidates: { state: 'ready', eligible: 4, input_version: 7 },
    });
  });

  it('hands the engine the version it read, so a racing answer discards it', async () => {
    // The whole of the stale-result protection: the version goes back with the
    // result, and `store_candidate_set` compares it under the plan's lock.
    await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    expect(called('store_candidate_set')[0]?.args['p_input_version']).toBe(7);
    expect(called('store_candidate_set')[0]?.args['p_revision']).toBe(1);
  });

  it("sends the engine's instants as ISO, which is what Postgres reads", async () => {
    await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    const sent = called('store_candidate_set')[0]?.args['p_set'] as {
      scoringVersion: number;
      eligible: { start: string }[];
    };
    expect(sent.scoringVersion).toBe(1);
    for (const candidate of sent.eligible) {
      expect(candidate.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('stores the answer even when the engine cannot run', async () => {
    // The answer is a committed transaction of its own. Reporting an error for
    // it would be false, and the retry would be refused as a replay of
    // something that worked (ADR 0018) — so the failure is a log line and the
    // response simply says nothing about candidates.
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'replace_response') {
        return { data: { id: '00000000-0000-4000-8000-0000000000r1', revision: 1 }, error: null };
      }
      return { data: null, error: { message: 'connection lost', code: undefined } };
    };

    const response = await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    expect(response.status).toBe(200);
    const answered = (await response.json()) as { response_id: string; candidates?: unknown };
    expect(answered.response_id).toBe('00000000-0000-4000-8000-0000000000r1');
    expect(answered.candidates).toBeUndefined();
  });

  it('says nothing about a plan the caller cannot see', async () => {
    state.rows = {};

    const response = await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'plan_not_found' });
  });

  it("turns the database's refusals into reasons a client can act on", async () => {
    // `replace_response` raises these by name, and the kit maps the name. A
    // message with the two revision numbers in it matched nothing, so the one
    // refusal a client knows how to recover from arrived as a 500.
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'replace_response') {
        return { data: null, error: { message: 'stale_revision', code: '40001' } };
      }
      return { data: null, error: null };
    };

    const response = await load('submit-availability')(
      post({ idempotency_key: KEY, plan_id: PLAN_ID, revision: 1, status: 'flexible' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'stale_revision' });
  });
});

describe('recalculate-candidates', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'a-shared-secret';
    state.answer = (fn) => {
      if (fn === 'engine_input') {
        return {
          data: {
            plan: {
              id: PLAN_ID,
              circle_id: '00000000-0000-4000-8000-0000000000c1',
              state: 'collecting',
              revision: 1,
              input_version: 2,
              scoring_version: 1,
              time_zone: 'Australia/Melbourne',
              window_start: '2099-09-17',
              window_end: '2099-09-20',
              daily_start_local: 1050,
              daily_end_local: 1350,
              duration_minutes: 120,
              quorum: 2,
              required_member_ids: [],
            },
            active_member_ids: [CALLER],
            responses: [],
          },
          error: null,
        };
      }
      if (fn === 'store_candidate_set') {
        return {
          data: {
            stored: true,
            state: 'collecting',
            eligible: 0,
            near_misses: 0,
            input_version: 2,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('is not something a member can call', async () => {
    // Internal (architecture §9.1). A member's own JWT is not the bearer this
    // takes, and the refusal says nothing about which part was wrong.
    const response = await load('recalculate-candidates')(post({ plan_id: PLAN_ID }));

    expect(response.status).toBe(401);
    expect(called('engine_input')).toHaveLength(0);
  });

  it('runs for the dispatcher, which knows the secret', async () => {
    const response = await load('recalculate-candidates')(
      post({ plan_id: PLAN_ID }, 'a-shared-secret'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'collecting', eligible: 0 });
  });

  it('is off entirely when no secret is configured', async () => {
    // An internal endpoint anybody can reach because a secret is missing is
    // worse than one nobody can reach.
    delete process.env.CRON_SECRET;

    const response = await load('recalculate-candidates')(
      post({ plan_id: PLAN_ID }, 'a-shared-secret'),
    );

    expect(response.status).toBe(401);
    expect(called('engine_input')).toHaveLength(0);
  });

  it('takes no version from its caller', async () => {
    // A caller who could name one could pin a recalculation to a version the
    // plan has left — the exact staleness the design exists to notice.
    const response = await load('recalculate-candidates')(
      post({ plan_id: PLAN_ID, input_version: 1 }, 'a-shared-secret'),
    );

    expect(response.status).toBe(200);
    expect(called('store_candidate_set')[0]?.args['p_input_version']).toBe(2);
  });
});

describe('confirm-meetup', () => {
  const CONFIRMATION = {
    id: '00000000-0000-4000-8000-0000000000f1',
    starts_at: '2099-09-17T08:30:00+00:00',
    ends_at: '2099-09-17T10:30:00+00:00',
    available_user_ids: [
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a2',
    ],
  };

  const body = {
    idempotency_key: KEY,
    plan_id: PLAN_ID,
    candidate_id: '2099-09-17T08:30:00.000Z',
    chased_answer: 'none' as const,
    expected_set_id: '00000000-0000-4000-8000-0000000000e1',
  };

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'confirm_meetup') return { data: CONFIRMATION, error: null };
      return { data: null, error: null };
    };
  });

  it('locks in the time the organiser chose, by the time itself', async () => {
    // A candidate's identity is its start instant, not a row id: the set is
    // recomputed whenever anybody answers, so an id the organiser was holding
    // would point at a row that no longer exists.
    const response = await load('confirm-meetup')(post(body));

    expect(response.status).toBe(200);
    expect(called('confirm_meetup')[0]?.args['p_candidate_id']).toBe('2099-09-17T08:30:00.000Z');
    expect(await response.json()).toMatchObject({
      confirmation_id: CONFIRMATION.id,
      going: CONFIRMATION.available_user_ids,
    });
  });

  it('carries the place, the note and the survey answer', async () => {
    await load('confirm-meetup')(
      post({
        ...body,
        place_name: 'Hope St Radio',
        place_url: 'https://maps.example/hope-st',
        note: 'Upstairs',
        chased_answer: 'one',
      }),
    );

    const args = called('confirm_meetup')[0]?.args;
    expect(args?.['p_place_name']).toBe('Hope St Radio');
    expect(args?.['p_note']).toBe('Upstairs');
    // Spec §5.10's micro-survey, asked on the review screen and stored with the
    // confirmation it is about. The evidence for H2.
    expect(args?.['p_chased_answer']).toBe('one');
  });

  it('refuses a place link that is not a link', async () => {
    // The confirmed screen turns this into something people tap, and a
    // `javascript:` URL is not a place.
    const response = await load('confirm-meetup')(
      post({ ...body, place_url: 'javascript:alert(1)' }),
    );

    expect(response.status).toBe(400);
    expect(called('confirm_meetup')).toHaveLength(0);
  });

  it('sends the set the organiser was shown, not the one that is current', async () => {
    // An answer landing while the review screen is open recalculates inline,
    // so by the time the tap arrives there is a new current set. Confirming
    // against it would freeze an availability list nobody looked at.
    await load('confirm-meetup')(post(body));

    expect(called('confirm_meetup')[0]?.args['p_expected_set_id']).toBe(
      '00000000-0000-4000-8000-0000000000e1',
    );
  });

  it('will not confirm without saying which set it saw', async () => {
    const response = await load('confirm-meetup')(post({ ...body, expected_set_id: undefined }));

    expect(response.status).toBe(400);
    expect(called('confirm_meetup')).toHaveLength(0);
  });

  it('tells a stale screen apart from a time that is not on offer', async () => {
    // `candidate_is_eligible` answers one boolean for both, and they are
    // different sentences: one means "look again", the other means "not that
    // one". The SQL raises them separately so the client can say which.
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'confirm_meetup') {
        return { data: null, error: { message: 'stale_candidates', code: 'P0001' } };
      }
      return { data: null, error: null };
    };

    const response = await load('confirm-meetup')(post(body));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'stale_candidates' });
  });

  it('will not confirm without answering the survey', async () => {
    const withoutSurvey = { ...body, chased_answer: undefined };
    const response = await load('confirm-meetup')(post(withoutSurvey));

    expect(response.status).toBe(400);
    expect(called('confirm_meetup')).toHaveLength(0);
  });
});

describe('report-outcome', () => {
  const CONFIRMATION_ID = '00000000-0000-4000-8000-0000000000f1';

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rows = {};
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'confirmation_evidence') {
        // Counts and one comparison, never identities: the policy shows a
        // retrospective answer only to the person who gave it, so this is the
        // only way the organiser learns they were corroborated.
        return {
          data: { outcome: 'happened', was_there: 2, missed: 0, someone_else_was_there: true },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('files the organiser’s answer through the one write path there is', async () => {
    await load('report-outcome')(
      post({
        idempotency_key: KEY,
        confirmation_id: CONFIRMATION_ID,
        outcome: 'happened',
        note: 'Great night',
        moved_outside: false,
      }),
    );

    const args = called('report_outcome')[0]?.args;
    expect(args?.['p_outcome']).toBe('happened');
    expect(args?.['p_note']).toBe('Great night');
  });

  it('says corroborated when somebody other than the reporter was there', async () => {
    // §11.1 counts the two separately: "reported happened" is the organiser's
    // word for it, "corroborated happened" is a second person's.
    const response = await load('report-outcome')(
      post({
        idempotency_key: KEY,
        confirmation_id: CONFIRMATION_ID,
        outcome: 'happened',
        moved_outside: false,
      }),
    );

    expect(await response.json()).toMatchObject({
      corroboration: 'corroborated',
      was_there: 2,
    });
  });

  it('writes a member’s own attendance within what a member may write', async () => {
    // `grant update (status) on public.attendance` and nothing else: a plain
    // upsert assigns every column it was given on conflict, and Postgres
    // refuses it for want of the grant — which would have made the ordinary
    // case, a row derived when the meetup was confirmed, the failing one. So:
    // insert if missing, then set the status.
    const response = await load('report-outcome')(
      post({ idempotency_key: KEY, confirmation_id: CONFIRMATION_ID, attendance: 'was_there' }),
    );

    expect(response.status).toBe(200);
    expect(called('report_outcome')).toHaveLength(0);
    expect(state.writes).toEqual([
      {
        table: 'attendance',
        method: 'upsert',
        values: { confirmation_id: CONFIRMATION_ID, user_id: CALLER, status: 'was_there' },
      },
      { table: 'attendance', method: 'update', values: { status: 'was_there' } },
    ]);
  });

  it('will not take an outcome without the second tap of the survey', async () => {
    // "Two taps each; this is the evidence for H2" (spec §5.10). An optional
    // half of a two-tap survey is a question most people never answer.
    const response = await load('report-outcome')(
      post({ idempotency_key: KEY, confirmation_id: CONFIRMATION_ID, outcome: 'happened' }),
    );

    expect(response.status).toBe(400);
    expect(called('report_outcome')).toHaveLength(0);
  });

  it('does not ask a member answering for themselves', async () => {
    // The survey is the organiser's, on the outcome screen. A member saying "I
    // was there" is not being asked whether the plan moved outside the app.
    const response = await load('report-outcome')(
      post({
        idempotency_key: KEY,
        confirmation_id: CONFIRMATION_ID,
        attendance: 'was_there',
        moved_outside: false,
      }),
    );

    expect(response.status).toBe(400);
  });

  it('refuses an outcome and an attendance in one request', async () => {
    // A statement about the evening and a statement about one person. Somebody
    // who is both the organiser and an attendee makes them one at a time.
    const response = await load('report-outcome')(
      post({
        idempotency_key: KEY,
        confirmation_id: CONFIRMATION_ID,
        outcome: 'happened',
        moved_outside: false,
        attendance: 'was_there',
      }),
    );

    expect(response.status).toBe(400);
    expect(called('report_outcome')).toHaveLength(0);
  });

  it('turns the database’s refusal into a reason', async () => {
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'report_outcome') {
        return { data: null, error: { message: 'not_the_organiser', code: '42501' } };
      }
      return { data: null, error: null };
    };

    const response = await load('report-outcome')(
      post({
        idempotency_key: KEY,
        confirmation_id: CONFIRMATION_ID,
        outcome: 'happened',
        moved_outside: false,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'not_the_organiser' });
  });
});

describe('generate-ics', () => {
  const CONFIRMATION_ID = '00000000-0000-4000-8000-0000000000f1';

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rows = {
      meetup_confirmations: {
        id: CONFIRMATION_ID,
        plan_id: PLAN_ID,
        revision: 1,
        starts_at: '2099-09-17T08:30:00+00:00',
        ends_at: '2099-09-17T10:30:00+00:00',
        available_user_ids: [CALLER],
        place_name: 'Hope St Radio',
        place_url: null,
        note: null,
        confirmed_by: CALLER,
        status: 'active',
        confirmed_at: '2099-09-16T00:00:00+00:00',
        plans: {
          title: 'Catch up',
          short_code: 'pncfmt',
          time_zone: 'Australia/Melbourne',
          circles: { name: 'Sunday Crew' },
        },
      },
    };
  });

  it('answers with a calendar file a browser will save', async () => {
    const response = await load('generate-ics')(get({ confirmation_id: CONFIRMATION_ID }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    // The date on the invitation, not the one in UTC. 18:30 in Melbourne is
    // 08:30Z the same day; in Los Angeles the same evening is the *next* day in
    // UTC, and a file named for a Thursday that says Wednesday inside it is a
    // file somebody will open twice.
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sunday-crew-2099-09-17.ics"',
    );
    // Nothing cached: a confirmation is the kind of thing that gets cancelled.
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.text();
    // DTSTART is UTC, whatever zone the circle keeps: a calendar reads the
    // instant, and the local time is what the app renders.
    expect(body).toContain('DTSTART:20990917T083000Z');
    expect(body).toContain('SUMMARY:Sunday Crew · Catch up');
    expect(body).toContain('STATUS:CONFIRMED');
  });

  it('carries the plan’s short link and no token of any kind', async () => {
    // An `.ics` is forwarded, synced and indexed by desktop search
    // (architecture §14), so the only link in it is a public path.
    const body = await (
      await load('generate-ics')(get({ confirmation_id: CONFIRMATION_ID }))
    ).text();

    expect(body).toContain('/p/pncfmt');
    expect(body).not.toMatch(/token|secret|[?]t=/i);
  });

  it('names the file for the local date, not the UTC one', async () => {
    // 18:30 on the 17th in Los Angeles is 01:30Z on the 18th.
    state.rows = {
      meetup_confirmations: {
        ...(state.rows['meetup_confirmations'] as Record<string, unknown>),
        starts_at: '2099-09-18T01:30:00+00:00',
        ends_at: '2099-09-18T03:30:00+00:00',
        plans: {
          title: 'Catch up',
          short_code: 'pncfmt',
          time_zone: 'America/Los_Angeles',
          circles: { name: 'Sunday Crew' },
        },
      },
    };

    const response = await load('generate-ics')(get({ confirmation_id: CONFIRMATION_ID }));

    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="sunday-crew-2099-09-17.ics"',
    );
  });

  it('marks a rescheduled meetup cancelled rather than refusing the file', async () => {
    // "Thursday is off the table" (spec §5.7) is a thing a calendar has to be
    // told; refusing would leave the old event sitting in it.
    state.rows = {
      meetup_confirmations: {
        ...(state.rows['meetup_confirmations'] as object),
        status: 'superseded',
      },
    };

    const body = await (
      await load('generate-ics')(get({ confirmation_id: CONFIRMATION_ID }))
    ).text();

    expect(body).toContain('STATUS:CANCELLED');
  });

  it('says nothing about a confirmation the caller cannot see', async () => {
    // RLS answers "may this person see this?", so a stranger and a
    // confirmation that does not exist get the same answer.
    state.rows = {};

    const response = await load('generate-ics')(get({ confirmation_id: CONFIRMATION_ID }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'confirmation_not_found' });
  });

  it('takes a GET and nothing else', async () => {
    const response = await load('generate-ics')(post({ confirmation_id: CONFIRMATION_ID }));
    expect(response.status).toBe(405);
  });
});

describe('request-email-updates', () => {
  const body = { idempotency_key: KEY, plan_id: PLAN_ID, email: 'Jules@example.com ' };

  beforeEach(() => {
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'request_email_updates') return { data: { sent: true }, error: null };
      return { data: null, error: null };
    };
  });

  it('normalises the address before anybody stores or counts it', async () => {
    // Trimmed, lower-cased, NFC. A person who typed the same address twice on
    // two keyboards should not end up with two contacts, and the rate limit
    // counts one address rather than its spellings.
    await load('request-email-updates')(post(body));

    expect(called('request_email_updates')[0]?.args['p_email']).toBe('jules@example.com');
  });

  it('says only "check your email", whatever happened', async () => {
    // Verified already, suppressed after a bounce, held by somebody else, never
    // seen: one answer. Anything else lets a member walk a list of addresses
    // through a plan and learn which of their friends use the product.
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'request_email_updates') return { data: { sent: false }, error: null };
      return { data: null, error: null };
    };

    const response = await load('request-email-updates')(post(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'check_email' });
  });

  it('mints no token, because a token minted here could never reach the email', async () => {
    // Round 2's P1. An earlier draft made one, hashed it into the database and
    // dropped the readable half — `jobs.notification_jobs` has no payload
    // column, so there was no route from here to the letter, and every
    // verification link was unsendable. The sender mints it now (ADR 0020).
    const response = await load('request-email-updates')(post(body));
    const answered = JSON.stringify(await response.json());
    const args = called('request_email_updates')[0]?.args ?? {};

    expect(Object.keys(args)).not.toContain('p_token_hash');
    expect(answered).not.toContain('jules@example.com');
  });

  it('names the request as the occurrence, so a resend is a second email', async () => {
    // A retry never reaches the function — the idempotency claim answers it —
    // and a genuine resend is a different request, so the job it writes has a
    // different key rather than being swallowed as a duplicate.
    const response = await load('request-email-updates')(post(body));
    const requestId = response.headers.get('x-request-id');
    const passed = called('request_email_updates')[0]?.args['p_request_id'];

    expect(typeof passed).toBe('string');
    expect(passed).toBe(requestId);
  });

  it('records which words were consented to', async () => {
    await load('request-email-updates')(post(body));

    // A consent record that cannot say what was agreed is not one.
    expect(called('request_email_updates')[0]?.args['p_consent_version']).toBe(CONSENT.version);
  });

  it('counts the attempt against this person and this address, not the address', async () => {
    // A counter keyed on the address alone is shared by everybody who can name
    // it — and `take_rate_token` counts refusals — so three requests naming
    // somebody else's address would lock its real owner out for the day, and a
    // 429 on a first attempt would say that somebody else had asked about it.
    await load('request-email-updates')(post(body));

    expect(called('take_rate_token')).toHaveLength(3);
    // Sorted, because `enforce` runs the three counters in one `Promise.all`
    // and the order they land in is whichever hash finished first. Asserting
    // the arrival order made this pass or fail by timing.
    const scopes = called('take_rate_token')
      .map((call) => call.args['p_scope'])
      .sort();
    expect(scopes).toEqual(['email_request', 'email_request_ip', 'email_request_user']);
    // Hashed before it leaves, like every rate key: an address is a person.
    expect(JSON.stringify(called('take_rate_token'))).not.toContain('jules@example.com');
  });

  it('refuses a request that is not an address', async () => {
    const response = await load('request-email-updates')(post({ ...body, email: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(called('request_email_updates')).toHaveLength(0);
  });
});

describe('track-events', () => {
  const EVENT = {
    event_id: '00000000-0000-4000-8000-0000000000f1',
    name: 'circle_join_opened',
    version: 1,
    occurred_at: '2026-03-01T00:00:00.000Z',
    properties: {},
  };

  beforeEach(() => {
    state.answer = (fn) => {
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'record_events') return { data: 1, error: null };
      return { data: null, error: null };
    };
  });

  it('counts the top of the funnel for somebody who has no session at all', async () => {
    // A link opened from a group chat precedes a join by definition. Refusing
    // an event because nobody is signed in would lose exactly the events the
    // funnel is about.
    const response = await load('track-events')(
      postWithoutSession({ events: [EVENT], anonymous_id: 'browser-abc12345' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 0 });
    const rows = called('record_events')[0]?.args['p_rows'] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ user_id: null });
    // Hashed, never stored as sent: the schema cannot tell a browser id from a
    // re-entry token, which is base64url and exactly this length.
    expect(rows[0]?.['anonymous_id']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('browser-abc12345');
  });

  it('drops the browser id once a bearer says who this is', async () => {
    // A row carrying both is a join from everything this browser did before
    // signing in to the account it signed in to.
    await load('track-events')(post({ events: [EVENT], anonymous_id: 'browser-abc12345' }));

    const rows = called('record_events')[0]?.args['p_rows'] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ user_id: CALLER, anonymous_id: null });
  });

  it('attributes an event to the caller when the bearer is a real user', async () => {
    await load('track-events')(post({ events: [EVENT] }));

    const rows = called('record_events')[0]?.args['p_rows'] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ user_id: CALLER });
  });

  it('records anonymously rather than refusing when the bearer is not a user token', async () => {
    // `supabase-js` sends the publishable key when there is no session, and a
    // tab open for a week sends a JWT that has expired. Neither is a refusal:
    // it is an event with no `user_id`, which is what `anonymous_id` is for.
    state.users = [{ error: { status: 401 } }];

    const response = await load('track-events')(post({ events: [EVENT] }));

    expect(response.status).toBe(200);
    const rows = called('record_events')[0]?.args['p_rows'] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ user_id: null });
  });

  it('keeps the batch when the auth server cannot be asked', async () => {
    // Attribution survives an outage: 503 means the client holds the batch and
    // tries again, rather than silently recording a week of events as nobody's.
    state.users = [{ error: {} }];

    const response = await load('track-events')(post({ events: [EVENT] }));

    expect(response.status).toBe(503);
    expect(called('record_events')).toHaveLength(0);
  });

  it('accepts what the catalogue knows and drops the rest, in one batch', async () => {
    const response = await load('track-events')(
      post({
        events: [
          EVENT,
          { ...EVENT, event_id: '00000000-0000-4000-8000-0000000000f2', name: 'not_an_event' },
          {
            ...EVENT,
            event_id: '00000000-0000-4000-8000-0000000000f3',
            name: 'availability_submitted',
            properties: { status: 'made_up' },
          },
        ],
      }),
    );

    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 2 });
  });

  it('drops a key the catalogue does not declare without losing the event', async () => {
    await load('track-events')(
      post({
        events: [
          {
            ...EVENT,
            name: 'circle_created',
            properties: { note: 'dinner with Maya', circle_id: CIRCLE_ID },
          },
        ],
      }),
    );

    const rows = called('record_events')[0]?.args['p_rows'] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // The id is lifted into its own column and the words never existed.
    expect(rows[0]).toMatchObject({ circle_id: CIRCLE_ID, properties: {} });
    expect(JSON.stringify(rows)).not.toContain('Maya');
  });

  it('refuses a version the catalogue does not hold', async () => {
    // An old client sending a shape that has since changed, or a new one ahead
    // of the server: either way the payload's meaning is not knowable.
    const response = await load('track-events')(post({ events: [{ ...EVENT, version: 99 }] }));

    expect(await response.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect(called('record_events')).toHaveLength(0);
  });

  it('records an unbelievable clock as now rather than losing the batch', async () => {
    // `z.iso.datetime` accepts a year Postgres will not store, and one such
    // event raises inside `record_events` and takes the other forty-nine with
    // it. A plausible-but-wrong clock is quieter and worse: a real event filed
    // in a month nobody looks at.
    await load('track-events')(
      post({
        events: [
          { ...EVENT, occurred_at: '0000-01-01T00:00:00.000Z' },
          {
            ...EVENT,
            event_id: '00000000-0000-4000-8000-0000000000f4',
            occurred_at: '1970-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const rows = called('record_events')[0]?.args['p_rows'] as { occurred_at: string }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Date.parse(row.occurred_at)).toBeGreaterThan(Date.now() - 60_000);
    }
  });

  it('keeps a clock that is merely a little off', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await load('track-events')(post({ events: [{ ...EVENT, occurred_at: yesterday }] }));

    const rows = called('record_events')[0]?.args['p_rows'] as { occurred_at: string }[];
    expect(rows[0]?.occurred_at).toBe(yesterday);
  });

  it('charges the limit for every event, not once for the batch', async () => {
    // A batch is up to fifty. Charging one token a request made "six hundred a
    // minute" mean thirty thousand.
    await load('track-events')(
      post({
        events: [EVENT, { ...EVENT, event_id: '00000000-0000-4000-8000-0000000000f5' }],
      }),
    );

    for (const call of called('take_rate_token')) {
      expect(call.args['p_cost']).toBe(2);
    }
  });

  it('counts the attempt against the connection as well as the caller', async () => {
    await load('track-events')(post({ events: [EVENT] }));

    const scopes = called('take_rate_token')
      .map((call) => call.args['p_scope'])
      .sort();
    expect(scopes).toEqual(['track_ip', 'track_user']);
  });

  it('counts only the connection when there is nobody to count against', async () => {
    await load('track-events')(postWithoutSession({ events: [EVENT] }));

    expect(called('take_rate_token').map((call) => call.args['p_scope'])).toEqual(['track_ip']);
  });

  it('refuses a batch bigger than the cap rather than trimming it silently', async () => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      ...EVENT,
      event_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    const response = await load('track-events')(post({ events }));

    expect(response.status).toBe(400);
    expect(called('record_events')).toHaveLength(0);
  });
});

describe('verify-email-contact', () => {
  const TOKEN = 'a'.repeat(43);

  beforeEach(() => {
    state.answer = (fn) => {
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'verify_email_contact') {
        return {
          data: {
            active_plans: [
              {
                plan_id: PLAN_ID,
                short_code: 'pnemab',
                plan_title: 'Catch up',
                circle_name: 'Sunday Crew',
              },
            ],
            already_confirmed: true,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('takes no session at all', async () => {
    // Somebody verifying may have cleared their storage or be on another
    // device. Requiring a sign-in to confirm an address asks them to do the
    // thing the address exists to avoid.
    const response = await load('verify-email-contact')(postWithoutSession({ token: TOKEN }));

    expect(response.status).toBe(200);
    // Named, not numbered: the page is opened wherever the mail was read, so
    // there is usually no session and a plan is readable only by a member.
    expect(await response.json()).toMatchObject({
      active_plans: [{ plan_id: PLAN_ID, short_code: 'pnemab', circle_name: 'Sunday Crew' }],
      already_confirmed: true,
    });
  });

  it('hashes the token on the way in', async () => {
    await load('verify-email-contact')(postWithoutSession({ token: TOKEN }));

    const args = called('verify_email_contact')[0]?.args;
    expect(args?.['p_token_hash']).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(TOKEN);
  });

  it('refuses an unusable link by naming the field and never the token', async () => {
    // `linkHandler`'s one privacy-bearing branch, and nothing else asserted it:
    // a validation failure reports *field names*, because the field here is
    // called `token` and its value is the one thing in the product that must
    // never reach a response or a log (§14). Zod's own message would quote it.
    // Long enough, but not the alphabet a token is in — so it is refused, and
    // it is exactly the sort of string somebody pastes out of an email.
    const secret = 'S3cret.Token.That.Must.Not.Be.Logged.Ever';
    const lines: string[] = [];
    const sinks = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );

    try {
      const response = await load('verify-email-contact')(postWithoutSession({ token: secret }));

      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain('token');
      expect(body).not.toContain(secret);
      expect(lines.join('\n')).not.toContain(secret);
    } finally {
      for (const sink of sinks) sink.mockRestore();
    }
  });

  it('says one thing about a spent, expired or invented link', async () => {
    state.answer = (fn) => {
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'verify_email_contact') {
        return { data: null, error: { message: 'link_expired', code: 'P0001' } };
      }
      return { data: null, error: null };
    };

    const response = await load('verify-email-contact')(postWithoutSession({ token: TOKEN }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'link_expired' });
  });
});

describe('manage-email-preferences', () => {
  const TOKEN = 'b'.repeat(43);

  beforeEach(() => {
    state.answer = (fn) => {
      if (fn === 'take_rate_token') return { data: true, error: null };
      if (fn === 'email_preferences') {
        return {
          data: {
            removed: false,
            subscriptions: [
              {
                plan_id: PLAN_ID,
                plan_title: 'Catch up',
                circle_name: 'Sunday Crew',
                active: true,
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('shows what an address hears about, with no sign-in', async () => {
    const response = await load('manage-email-preferences')(
      postWithoutSession({ token: TOKEN, action: 'view' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      subscriptions: [{ circle_name: 'Sunday Crew', active: true }],
    });
  });

  it('stops one meetup, and needs to know which', async () => {
    // "Stop emails for this meetup" is the narrow link; the broad one is a
    // different action, not the same one with a field left out.
    const refused = await load('manage-email-preferences')(
      postWithoutSession({ token: TOKEN, action: 'stop_plan' }),
    );
    expect(refused.status).toBe(400);

    await load('manage-email-preferences')(
      postWithoutSession({ token: TOKEN, action: 'stop_plan', plan_id: PLAN_ID }),
    );
    expect(called('email_preferences')[0]?.args['p_plan_id']).toBe(PLAN_ID);
  });

  it('refuses a plan on an action that is not about one', async () => {
    const response = await load('manage-email-preferences')(
      postWithoutSession({ token: TOKEN, action: 'remove_contact', plan_id: PLAN_ID }),
    );

    expect(response.status).toBe(400);
    expect(called('email_preferences')).toHaveLength(0);
  });
});
