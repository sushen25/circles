import { createHash, createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three functions that run a circle (S1-23), loaded and driven the way
 * `handlers.test.ts` drives the rest: `Deno.serve` hands the composed handler
 * back, and `_shared/db.ts` is a recording fake.
 *
 * What matters most here is where the invite secret goes. It is derived from
 * the invite's id under `INVITE_LINK_KEY` (ADR 00XX); only its digest may reach
 * the database, and `get-invite-link` may hand it back only when the digest the
 * database holds is the digest of what it derived.
 */

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string, _args: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }),
  users: [] as { id: string; is_anonymous: boolean }[],
  served: [] as ((request: Request) => Promise<Response>)[],
  logged: [] as string[],
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
  'get-invite-link': await serveOf('get-invite-link'),
  'rotate-invite': await serveOf('rotate-invite'),
  'remove-member': await serveOf('remove-member'),
  'create-circle': await serveOf('create-circle'),
};

const OWNER = '00000000-0000-4000-8000-00000000000a';
const MEMBER = '00000000-0000-4000-8000-00000000000b';
const CIRCLE = '00000000-0000-4000-8000-0000000000c1';
const INVITE = '00000000-0000-4000-8000-0000000000f1';
const PLAN = '00000000-0000-4000-8000-0000000000b1';
const KEY = '00000000-0000-4000-8000-000000000001';
// Built at run time: a secret-shaped literal is what a scanner looks for.
const LINK_KEY = `test-${globalThis.crypto.randomUUID()}`;

function post(body: unknown): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer a.token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const called = (fn: string) => state.rpcs.filter((call) => call.fn === fn);

/** What the function should derive, computed independently of `_shared/secret.ts`. */
function expectedSecret(inviteId: string): string {
  return createHmac('sha256', LINK_KEY).update(`circles.invite.v1:${inviteId}`).digest('base64url');
}

function digestOf(secret: string): string {
  return `\\x${createHash('sha256').update(secret).digest('hex')}`;
}

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
  process.env.INVITE_LINK_KEY = LINK_KEY;
  state.rpcs = [];
  state.users = [{ id: OWNER, is_anonymous: false }];
  state.answer = (fn) => bookkeeping(fn) ?? { data: null, error: null };
});

describe('get-invite-link', () => {
  it('derives the live invite’s secret and hands it back when the digest matches', async () => {
    const secret = expectedSecret(INVITE);
    state.answer = (fn) =>
      fn === 'live_invite'
        ? { data: [{ invite_id: INVITE, secret_hash: digestOf(secret) }], error: null }
        : { data: null, error: null };

    const response = await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invite_secret: secret });
    expect(called('live_invite')[0]?.args).toEqual({ p_circle_id: CIRCLE });
  });

  it('answers null for a link that was not derived — it can only be reset', async () => {
    state.answer = (fn) =>
      fn === 'live_invite'
        ? { data: [{ invite_id: INVITE, secret_hash: digestOf('made-at-random') }], error: null }
        : { data: null, error: null };

    const response = await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(await response.json()).toEqual({ invite_secret: null });
  });

  it('answers null without the key rather than inventing a link', async () => {
    delete process.env.INVITE_LINK_KEY;
    state.answer = (fn) =>
      fn === 'live_invite'
        ? {
            data: [{ invite_id: INVITE, secret_hash: digestOf(expectedSecret(INVITE)) }],
            error: null,
          }
        : { data: null, error: null };

    const response = await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(await response.json()).toEqual({ invite_secret: null });
  });

  it('answers null for a circle with no live link', async () => {
    state.answer = (fn) =>
      fn === 'live_invite' ? { data: [], error: null } : { data: null, error: null };

    const response = await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(await response.json()).toEqual({ invite_secret: null });
  });

  it('passes the database’s refusal through as not_the_owner', async () => {
    state.users = [{ id: MEMBER, is_anonymous: true }];
    state.answer = (fn) =>
      fn === 'live_invite'
        ? { data: null, error: { code: '42501', message: 'not_the_owner' } }
        : { data: null, error: null };

    const response = await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'not_the_owner' });
  });

  it('claims no idempotency key, so no record keeps the secret', async () => {
    state.answer = (fn) =>
      fn === 'live_invite'
        ? {
            data: [{ invite_id: INVITE, secret_hash: digestOf(expectedSecret(INVITE)) }],
            error: null,
          }
        : { data: null, error: null };

    await handlers['get-invite-link'](post({ circle_id: CIRCLE }));

    expect(called('begin_request')).toHaveLength(0);
    expect(called('finish_request')).toHaveLength(0);
  });
});

describe('rotate-invite', () => {
  it('issues a derived secret for a fresh invite id, and gives the database only its digest', async () => {
    const response = await handlers['rotate-invite'](
      post({ idempotency_key: KEY, circle_id: CIRCLE }),
    );
    const { invite_secret: secret } = (await response.json()) as { invite_secret: string };

    expect(response.status).toBe(200);
    const [issued] = called('issue_invite');
    const inviteId = issued?.args['p_invite_id'] as string;
    expect(inviteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secret).toBe(expectedSecret(inviteId));
    expect(issued?.args['p_secret_hash']).toBe(digestOf(secret));
    expect(JSON.stringify(called('issue_invite'))).not.toContain(secret);
  });

  it('gives a new secret every time, because every reset is a new invite', async () => {
    const first = (await (
      await handlers['rotate-invite'](post({ idempotency_key: KEY, circle_id: CIRCLE }))
    ).json()) as { invite_secret: string };
    state.users = [{ id: OWNER, is_anonymous: false }];
    const second = (await (
      await handlers['rotate-invite'](post({ idempotency_key: KEY, circle_id: CIRCLE }))
    ).json()) as { invite_secret: string };

    expect(first.invite_secret).not.toBe(second.invite_secret);
  });

  it('still makes a link without the key, just not one that can be shown again', async () => {
    delete process.env.INVITE_LINK_KEY;

    const response = await handlers['rotate-invite'](
      post({ idempotency_key: KEY, circle_id: CIRCLE }),
    );

    expect(response.status).toBe(200);
    expect(called('issue_invite')[0]?.args).not.toHaveProperty('p_invite_id');
  });

  it('refuses a member with not_the_owner, from the database', async () => {
    state.users = [{ id: MEMBER, is_anonymous: true }];
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'issue_invite'
        ? { data: null, error: { code: '42501', message: 'not_the_owner' } }
        : { data: null, error: null });

    const response = await handlers['rotate-invite'](
      post({ idempotency_key: KEY, circle_id: CIRCLE }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'not_the_owner' });
  });

  it('counts resets against the owner', async () => {
    await handlers['rotate-invite'](post({ idempotency_key: KEY, circle_id: CIRCLE }));

    expect(called('take_rate_token')[0]?.args).toMatchObject({ p_scope: 'rotate_invite' });
  });
});

describe('create-circle', () => {
  it('derives its first link too, so the owner can see it again after a reload', async () => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'create_circle'
        ? {
            data: {
              id: CIRCLE,
              name: 'Sunday Crew',
              color: 'sky',
              time_zone: 'Australia/Melbourne',
              cadence: 'monthly',
              short_code: 'jmhzcew29t',
              status: 'active',
              last_met_at: null,
            },
            error: null,
          }
        : { data: null, error: null });

    const response = await handlers['create-circle'](
      post({
        idempotency_key: KEY,
        name: 'Sunday Crew',
        color: 'sky',
        time_zone: 'Australia/Melbourne',
        cadence: 'monthly',
      }),
    );
    const { invite_secret: secret } = (await response.json()) as { invite_secret: string };

    const args = called('create_circle')[0]?.args ?? {};
    expect(secret).toBe(expectedSecret(args['invite_id'] as string));
    expect(args['invite_secret_hash']).toBe(digestOf(secret));
  });
});

describe('remove-member', () => {
  const body = { idempotency_key: KEY, circle_id: CIRCLE, user_id: MEMBER };

  it('removes through the database and recalculates every plan it made stale', async () => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'remove_member' ? { data: [PLAN], error: null } : { data: null, error: null });

    const response = await handlers['remove-member'](post(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, affected_plans: 1 });
    expect(called('remove_member')[0]?.args).toEqual({ p_circle_id: CIRCLE, p_user_id: MEMBER });
    // The engine's own read, for the plan the removal named (ADR 0018).
    expect(called('engine_input')[0]?.args).toEqual({ p_plan_id: PLAN });
  });

  it('answers 200 when the engine cannot run, because the removal is committed', async () => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'remove_member'
        ? { data: [PLAN], error: null }
        : fn === 'engine_input'
          ? { data: null, error: { code: '57014', message: 'canceling statement' } }
          : { data: null, error: null });

    const response = await handlers['remove-member'](post(body));

    expect(response.status).toBe(200);
  });

  it('recalculates nothing when no plan was asking', async () => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'remove_member' ? { data: [], error: null } : { data: null, error: null });

    const response = await handlers['remove-member'](post(body));

    expect(await response.json()).toEqual({ ok: true, affected_plans: 0 });
    expect(called('engine_input')).toHaveLength(0);
  });

  it.each([
    ['not_the_owner', 403],
    ['cannot_remove_owner', 409],
    ['member_not_found', 404],
  ])('says %s as the database does', async (reason, status) => {
    state.answer = (fn) =>
      bookkeeping(fn) ??
      (fn === 'remove_member'
        ? { data: null, error: { code: 'P0001', message: reason } }
        : { data: null, error: null });

    const response = await handlers['remove-member'](post(body));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ reason });
    expect(called('engine_input')).toHaveLength(0);
  });
});
