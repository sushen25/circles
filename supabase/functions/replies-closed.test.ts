import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two ways out of "replies closed with no decision" that are new endpoints
 * (S2-05): `hand-off-organiser` and `extend-deadline`, loaded and driven the way
 * `circle-admin.test.ts` drives its three — `Deno.serve` hands the composed
 * handler back, and `_shared/db.ts` is a recording fake.
 *
 * Both are thin on purpose: every rule is in the database, and pgTAP
 * (`240_replies_closed.sql`) holds them to it. What is left to prove here is
 * the part a handler can get wrong — what it sends, what it answers, and that
 * the database's refusal reaches the client as the reason a screen turns on.
 */

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string, _args: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }),
  users: [] as { id: string; is_anonymous: boolean }[],
  served: [] as ((request: Request) => Promise<Response>)[],
}));

const client = vi.hoisted(() => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    state.rpcs.push({ fn, args });
    return Promise.resolve(state.answer(fn, args));
  },
  from: () => {
    throw new Error('these functions read nothing but through their RPCs');
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
  'hand-off-organiser': await serveOf('hand-off-organiser'),
  'extend-deadline': await serveOf('extend-deadline'),
};

const MAYA = '00000000-0000-4000-8000-0000000000a1';
const PRIYA = '00000000-0000-4000-8000-0000000000a2';
const PLAN = '00000000-0000-4000-8000-0000000000b1';
const KEY = '00000000-0000-4000-8000-000000000001';

function post(body: unknown): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer a.token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const called = (fn: string) => state.rpcs.filter((call) => call.fn === fn);

function bookkeeping(fn: string): { data: unknown; error: unknown } | undefined {
  if (fn === 'begin_request') {
    return { data: [{ state: 'fresh', response_status: null, response_body: null }], error: null };
  }
  if (fn === 'take_rate_token') return { data: true, error: null };
  return undefined;
}

const refusing = (name: string, reason: string) => (fn: string) =>
  bookkeeping(fn) ??
  (fn === name
    ? { data: null, error: { code: 'P0001', message: reason } }
    : { data: null, error: null });

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.rpcs = [];
  state.users = [{ id: MAYA, is_anonymous: false }];
  state.answer = (fn) => bookkeeping(fn) ?? { data: null, error: null };
});

describe('hand-off-organiser', () => {
  it('hands the plan to the member named, through the one function that decides', async () => {
    const response = await handlers['hand-off-organiser'](
      post({ idempotency_key: KEY, plan_id: PLAN, to_user_id: PRIYA }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(called('hand_off_organiser')[0]?.args).toEqual({
      p_plan_id: PLAN,
      p_to_user_id: PRIYA,
    });
  });

  it('refuses a guest as requires_saved_place, which the sheet words', async () => {
    state.answer = refusing('hand_off_organiser', 'requires_saved_place');

    const response = await handlers['hand-off-organiser'](
      post({ idempotency_key: KEY, plan_id: PLAN, to_user_id: PRIYA }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'requires_saved_place' });
  });

  it('refuses a member who is not organising', async () => {
    state.answer = refusing('hand_off_organiser', 'not_the_organiser');

    const response = await handlers['hand-off-organiser'](
      post({ idempotency_key: KEY, plan_id: PLAN, to_user_id: PRIYA }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'not_the_organiser' });
  });

  it('refuses a request with nobody to hand it to before it reaches the database', async () => {
    const response = await handlers['hand-off-organiser'](
      post({ idempotency_key: KEY, plan_id: PLAN }),
    );

    expect(response.status).toBe(400);
    expect(called('hand_off_organiser')).toHaveLength(0);
  });
});

describe('extend-deadline', () => {
  it('asks the database for the day, and answers with the deadline it set', async () => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'extend_deadline'
        ? { data: { id: PLAN, response_deadline: '2026-09-16T10:00:00.123456+00:00' }, error: null }
        : { data: null, error: null });

    const response = await handlers['extend-deadline'](
      post({ idempotency_key: KEY, plan_id: PLAN }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ response_deadline: '2026-09-16T10:00:00.123Z' });
    // The client proposes nothing: the plan and nothing else.
    expect(called('extend_deadline')[0]?.args).toEqual({ p_plan_id: PLAN });
  });

  it('passes a second extension back as already_extended', async () => {
    state.answer = refusing('extend_deadline', 'already_extended');

    const response = await handlers['extend-deadline'](
      post({ idempotency_key: KEY, plan_id: PLAN }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'already_extended' });
  });

  it('and a deadline with nowhere left to go as no_time_to_extend', async () => {
    state.answer = refusing('extend_deadline', 'no_time_to_extend');

    const response = await handlers['extend-deadline'](
      post({ idempotency_key: KEY, plan_id: PLAN }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'no_time_to_extend' });
  });

  it('refuses any length but a day at the boundary', async () => {
    const response = await handlers['extend-deadline'](
      post({ idempotency_key: KEY, plan_id: PLAN, hours: 48 }),
    );

    expect(response.status).toBe(400);
    expect(called('extend_deadline')).toHaveLength(0);
  });
});
