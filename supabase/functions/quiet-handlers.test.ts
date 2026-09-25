import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The quiet ask's three doors (S2-02): `create-plan` with `mode: 'quiet'`,
 * `answer-interest` and `accept-organiser`, driven the way `handlers.test.ts`
 * drives the rest — `Deno.serve` hands the composed handler back, and
 * `_shared/db.ts` is a recording fake.
 *
 * What the database decides is pgTAP's (`240_quiet_ask.sql`); the fifty
 * concurrent answers are the integration suite's. What is proved here is what
 * each function sends, what it refuses before sending anything, and that what
 * comes back carries no count and no source.
 */

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string): { data: unknown; error: unknown } => ({ data: null, error: null }),
  users: [] as { id: string; is_anonymous: boolean }[],
  rows: {} as Record<string, unknown>,
  served: [] as ((request: Request) => Promise<Response>)[],
}));

const client = vi.hoisted(() => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    state.rpcs.push({ fn, args });
    return Promise.resolve(state.answer(fn));
  },
  from: (table: string) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: state.rows[table] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: state.rows[table] ?? null, error: null }),
    };
    for (const method of ['select', 'eq']) builder[method] = () => builder;
    return builder;
  },
  auth: {
    getUser: () => {
      const next = state.users.shift();
      return Promise.resolve(
        next === undefined
          ? { data: { user: null }, error: { message: 'no', status: 401 } }
          : { data: { user: next }, error: null },
      );
    },
  },
}));

vi.mock('./_shared/db.ts', () => ({ asCaller: () => client, asService: () => client }));

(globalThis as { Deno?: unknown }).Deno = {
  env: { get: (key: string) => process.env[key] },
  serve: (handler: (request: Request) => Promise<Response>) => {
    state.served.push(handler);
    return undefined;
  },
};

async function serveOf(name: string): Promise<(request: Request) => Promise<Response>> {
  state.served = [];
  await import(`./${name}/index.ts`);
  const handler = state.served[0];
  if (handler === undefined) throw new Error(`${name} did not serve a handler`);
  return handler;
}

const handlers = {
  'create-plan': await serveOf('create-plan'),
  'answer-interest': await serveOf('answer-interest'),
  'accept-organiser': await serveOf('accept-organiser'),
  'quiet-view': await serveOf('quiet-view'),
};

const CALLER = '00000000-0000-4000-8000-00000000000c';
const KEY = '00000000-0000-4000-8000-000000000001';
const CIRCLE_ID = '00000000-0000-4000-8000-0000000000c1';
const PLAN_ID = '00000000-0000-4000-8000-0000000000e1';

function post(body: unknown): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer a.token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const called = (fn: string) => state.rpcs.filter((call) => call.fn === fn);

/** The database refusing by name, as `raise exception 'name'` arrives through PostgREST. */
const refused = (name: string) => ({ data: null, error: { message: name, code: 'P0001' } });

function bookkeeping(fn: string): { data: unknown; error: unknown } | undefined {
  if (fn === 'begin_request') {
    return { data: [{ state: 'fresh', response_status: null, response_body: null }], error: null };
  }
  if (fn === 'take_rate_token') return { data: true, error: null };
  return undefined;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  // Tuesday 15 September 2026, 10 am in Melbourne.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
  state.rpcs = [];
  state.users = [{ id: CALLER, is_anonymous: false }];
  state.rows = {};
  state.answer = (fn) => bookkeeping(fn) ?? { data: null, error: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('create-plan, quietly', () => {
  const body = {
    idempotency_key: KEY,
    circle_id: CIRCLE_ID,
    mode: 'quiet' as const,
    title: 'Catch up',
    preset: 'this_weekend' as const,
    stop_time: 'friday_midday' as const,
  };

  beforeEach(() => {
    state.rows = {
      circles: {
        time_zone: 'Australia/Melbourne',
        status: 'active',
        default_duration_minutes: 120,
        default_quorum: null,
      },
    };
    state.answer = (fn) => {
      if (fn === 'create_quiet_ask') {
        return {
          data: { id: PLAN_ID, short_code: 'jmhzcew2', quorum: 4, quiet_threshold: 3 },
          error: null,
        };
      }
      return bookkeeping(fn) ?? { data: null, error: null };
    };
  });

  it('resolves the window and the stop time, and hands both to create_quiet_ask', async () => {
    const response = await handlers['create-plan'](post(body));

    expect(response.status).toBe(200);
    expect(called('create_plan')).toHaveLength(0);
    expect(called('create_quiet_ask')[0]?.args).toMatchObject({
      // As the service role, for the verified caller (review round 1).
      p_actor: CALLER,
      p_circle_id: CIRCLE_ID,
      p_window_start: '2026-09-19',
      p_window_end: '2026-09-20',
      p_preset: 'this_weekend',
      // Friday midday in Melbourne, from the option's name — never an instant
      // from the client.
      p_quiet_expires_at: '2026-09-18T02:00:00.000Z',
    });
  });

  it('answers with when it closes and what opens it, and never a count', async () => {
    const payload = (await (await handlers['create-plan'](post(body))).json()) as Record<
      string,
      unknown
    >;
    expect(payload['quiet']).toEqual({ closes_at: '2026-09-18T02:00:00.000Z', threshold: 3 });
    expect(JSON.stringify(payload)).not.toMatch(/keen|initiator|count/i);
  });

  it('refuses a stop time this window does not offer, before asking anybody', async () => {
    // "In two days" belongs to a week's or a fortnight's window, not a weekend's.
    const response = await handlers['create-plan'](post({ ...body, stop_time: 'two_days' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: 'stop_time_unavailable' });
    expect(called('create_quiet_ask')).toHaveLength(0);
  });

  it.each([
    ['no stop time', { stop_time: undefined }],
    ['a custom window', { preset: 'custom', custom: { start: '2026-09-19', end: '2026-09-20' } }],
    ['a quorum', { quorum: 3 }],
    ['required members', { required_member_ids: [CALLER] }],
    ['a deadline', { response_deadline: '2026-09-18T00:00:00.000Z' }],
  ])('refuses %s: a quiet ask has no organiser to choose it', async (_what, change) => {
    const response = await handlers['create-plan'](post({ ...body, ...change }));

    expect(response.status).toBe(400);
    expect(called('create_quiet_ask')).toHaveLength(0);
  });

  it('refuses a stop time on a named plan', async () => {
    const response = await handlers['create-plan'](post({ ...body, mode: 'named' }));
    expect(response.status).toBe(400);
  });

  it('refuses a guest with the reason that opens InitiateGate', async () => {
    state.users = [{ id: CALLER, is_anonymous: true }];
    const response = await handlers['create-plan'](post(body));

    expect(await response.json()).toMatchObject({ reason: 'requires_saved_place' });
    expect(called('create_quiet_ask')).toHaveLength(0);
  });

  it.each([
    ['already_asking', 409],
    ['circle_ask_limit', 409],
    ['nobody_to_ask', 409],
    ['quiet_asks_muted', 409],
    ['plan_in_progress', 409],
  ])('passes the database’s %s through as a reason a screen can use', async (name, status) => {
    state.answer = (fn) =>
      fn === 'create_quiet_ask' ? refused(name) : (bookkeeping(fn) ?? { data: null, error: null });
    const response = await handlers['create-plan'](post(body));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ reason: name });
  });
});

describe('answer-interest', () => {
  const body = { idempotency_key: KEY, plan_id: PLAN_ID, interested: true };

  beforeEach(() => {
    state.rows = {
      plans: {
        mode: 'quiet',
        quiet_preset: 'this_weekend',
        window_start: '2026-09-19',
        window_end: '2026-09-20',
        daily_start_local: 1050,
        daily_end_local: 1350,
        duration_minutes: 120,
        time_zone: 'Australia/Melbourne',
      },
    };
    state.answer = (fn) =>
      fn === 'record_interest'
        ? { data: { threshold_reached: true }, error: null }
        : (bookkeeping(fn) ?? { data: null, error: null });
  });

  it('records the answer as the caller, with the deadline the ask would get if it opened now', async () => {
    const response = await handlers['answer-interest'](post(body));

    expect(response.status).toBe(200);
    expect(called('record_interest')[0]?.args).toEqual({
      p_plan_id: PLAN_ID,
      p_actor: CALLER,
      p_interested: true,
      // `defaultDeadline('this_weekend', now, …)`: a day from now.
      p_deadline_if_opened: '2026-09-16T00:00:00.000Z',
    });
  });

  it('answers that it was recorded, and nothing else — not even that it opened the ask', async () => {
    const payload = await (await handlers['answer-interest'](post(body))).json();
    expect(payload).toEqual({ recorded: true });
  });

  it('keeps the answer out of the fingerprint stored against the caller', async () => {
    // Review round 4: a sha256 of a body with two possible values is the answer.
    await handlers['answer-interest'](post(body));
    state.users = [{ id: CALLER, is_anonymous: false }];
    await handlers['answer-interest'](post({ ...body, interested: false }));
    const [keen, not] = called('begin_request').map((c) => c.args['p_fingerprint']);
    expect(keen).toBe(not);
  });

  it('refuses a named plan without recording anything', async () => {
    state.rows = {
      plans: { ...(state.rows['plans'] as object), mode: 'named', quiet_preset: null },
    };
    const response = await handlers['answer-interest'](post(body));

    expect(await response.json()).toMatchObject({ reason: 'not_quiet' });
    expect(called('record_interest')).toHaveLength(0);
  });

  it('says there is no such plan to somebody RLS shows none', async () => {
    state.rows = {};
    const response = await handlers['answer-interest'](post(body));

    expect(response.status).toBe(404);
    expect(called('record_interest')).toHaveLength(0);
  });

  it.each([
    ['interest_closed', 409],
    ['initiator_is_keen', 409],
  ])('passes %s through', async (name, status) => {
    state.answer = (fn) =>
      fn === 'record_interest' ? refused(name) : (bookkeeping(fn) ?? { data: null, error: null });
    const response = await handlers['answer-interest'](post(body));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ reason: name });
  });
});

describe('accept-organiser', () => {
  const body = { idempotency_key: KEY, plan_id: PLAN_ID };

  it('takes the role as the caller and says so', async () => {
    const response = await handlers['accept-organiser'](post(body));

    expect(await response.json()).toEqual({ organiser_member_id: CALLER });
    expect(called('accept_organiser')[0]?.args).toEqual({ p_plan_id: PLAN_ID });
  });

  it('never passes on a role the client claims: how somebody came to organise is the server’s', async () => {
    await handlers['accept-organiser'](post({ ...body, role: 'initiator' }));
    expect(JSON.stringify(called('accept_organiser'))).not.toContain('initiator');
  });

  it('refuses a guest before asking the database', async () => {
    state.users = [{ id: CALLER, is_anonymous: true }];
    const response = await handlers['accept-organiser'](post(body));

    expect(await response.json()).toMatchObject({ reason: 'requires_saved_place' });
    expect(called('accept_organiser')).toHaveLength(0);
  });

  it.each([
    ['already_taken', 409],
    ['not_keen', 403],
    ['deadline_not_passed', 409],
    ['wrong_state', 409],
  ])('passes %s through', async (name, status) => {
    state.answer = (fn) =>
      fn === 'accept_organiser' ? refused(name) : (bookkeeping(fn) ?? { data: null, error: null });
    const response = await handlers['accept-organiser'](post(body));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ reason: name });
  });
});

describe('quiet-view', () => {
  const body = { plan_id: PLAN_ID };
  const seeking = {
    id: PLAN_ID,
    circle_id: CIRCLE_ID,
    mode: 'quiet',
    state: 'seeking',
    organiser_user_id: null,
    title: 'Catch up',
    category: 'catch_up',
    time_zone: 'Australia/Melbourne',
    window_start: '2026-09-19',
    window_end: '2026-09-20',
    daily_start_local: 1050,
    daily_end_local: 1350,
    duration_minutes: 120,
    quorum: 3,
    response_deadline: '2026-09-18T02:00:00.000Z',
    quiet_threshold: 3,
    quiet_expires_at: '2026-09-18T02:00:00.000Z',
    revision: 1,
    input_version: 1,
    scoring_version: 1,
    short_code: 'jmhzcew2',
  };
  const facts = (isInitiator: boolean, myAnswer: string | null) => (fn: string) =>
    fn === 'quiet_viewer_facts'
      ? { data: { is_initiator: isInitiator, my_answer: myAnswer, ever_opened: null }, error: null }
      : (bookkeeping(fn) ?? { data: null, error: null });

  beforeEach(() => {
    state.rows = { plans: seeking, circles: { owner_user_id: 'someone-else' } };
  });

  it('asks for the private facts about the caller alone, with the service role', async () => {
    state.answer = facts(true, 'keen');
    await handlers['quiet-view'](post(body));
    expect(called('quiet_viewer_facts')[0]?.args).toEqual({
      p_plan_id: PLAN_ID,
      p_user_id: CALLER,
    });
  });

  it('gives the initiator the capabilities, never the facts', async () => {
    state.answer = facts(true, 'keen');
    const payload = await (await handlers['quiet-view'](post(body))).json();

    expect(payload).toEqual({
      view: {
        phase: 'seeking',
        closes_at: '2026-09-18T02:00:00.000Z',
        threshold: 3,
        answered_by_me: true,
        may_withdraw: true,
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/initiator|keen|not_this_time/);
  });

  it('shows two members who answered differently the same view', async () => {
    state.answer = facts(false, 'keen');
    const keen = await (await handlers['quiet-view'](post(body))).json();
    state.users = [{ id: CALLER, is_anonymous: false }];
    state.answer = facts(false, 'not_this_time');
    const not = await (await handlers['quiet-view'](post(body))).json();
    expect(keen).toEqual(not);
    expect(keen).toMatchObject({ view: { answered_by_me: true, may_withdraw: false } });
  });

  it('shows nothing to somebody who is not a member, and nothing about a named plan', async () => {
    state.answer = (fn) => bookkeeping(fn) ?? { data: null, error: null };
    expect(await (await handlers['quiet-view'](post(body))).json()).toEqual({ view: null });

    state.users = [{ id: CALLER, is_anonymous: false }];
    state.rows = { plans: { ...seeking, mode: 'named' } };
    expect(await (await handlers['quiet-view'](post(body))).json()).toEqual({ view: null });
    expect(called('quiet_viewer_facts')).toHaveLength(1);
  });

  it('offers the role to a keen member once the ask has opened, with the count it opened with', async () => {
    state.rows = {
      plans: { ...seeking, state: 'collecting' },
      circles: { owner_user_id: 'someone-else' },
      plan_interest_counts: { keen_count: 3 },
    };
    state.answer = facts(false, 'keen');
    expect(await (await handlers['quiet-view'](post(body))).json()).toEqual({
      view: { phase: 'opened', keen_count: 3, organiser: null, may_take_role: true },
    });
  });
});
