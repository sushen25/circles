import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * The wrapper, driven end to end with the database stubbed out.
 *
 * Worth testing at this level rather than in pieces, because the two bugs the
 * first review round found were both about *sequencing* — which RPC runs after
 * which failure — and no unit of the kit is wrong on its own. Both are asserted
 * here by name.
 */

const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string) => ({ data: null as unknown, error: null as unknown }),
  user: { id: '00000000-0000-4000-8000-00000000user', is_anonymous: true } as {
    id: string;
    is_anonymous: boolean;
  } | null,
  // `supabase-js` returns an `AuthRetryableFetchError` here rather than throwing,
  // and it carries no HTTP status — which is how "could not ask" is told apart
  // from "asked and told no".
  authError: null as { message: string; status?: number } | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      return Promise.resolve(state.answer(fn));
    },
    auth: {
      getUser: () =>
        Promise.resolve(
          state.authError !== null
            ? { data: { user: null }, error: state.authError }
            : state.user === null
              ? { data: { user: null }, error: Object.assign(new Error('no'), { status: 401 }) }
              : { data: { user: state.user }, error: null },
        ),
    },
  }),
}));

const { jsonHandler } = await import('./http.ts');
const { Refusal, Unavailable } = await import('./problem.ts');

const KEY = '00000000-0000-4000-8000-000000000001';
const Body = z.object({ idempotency_key: z.string(), display_name: z.string().max(5) });

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: { authorization: 'Bearer a.token', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const called = (fn: string) => state.calls.filter((call) => call.fn === fn);

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.calls = [];
  state.user = { id: '00000000-0000-4000-8000-00000000user', is_anonymous: true };
  state.authError = null;
  state.answer = (fn) =>
    fn === 'begin_request'
      ? { data: [{ state: 'fresh', response_status: null, response_body: null }], error: null }
      : { data: null, error: null };
});

describe('a request that works', () => {
  it('records the answer and keeps the claim', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({ joined: true }),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ joined: true });
    expect(called('finish_request')).toHaveLength(1);
    expect(called('release_request')).toHaveLength(0);
  });

  it('gives a reference of its own making', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never takes the reference from the caller', async () => {
    // The reference goes into every log line this request writes. It used to be
    // accepted from `X-Request-Id` whenever it matched `^[A-Za-z0-9_-]{1,64}$`, on
    // the reasoning that a shape check made the contents known — and `OpaqueToken`
    // in `packages/contracts` is `^[A-Za-z0-9_-]+$`, so the filter admitted exactly
    // the thing non-negotiable 8 forbids in a log.
    const tokenShaped = 'x'.repeat(43);
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(
      post({ idempotency_key: KEY, display_name: 'Priya' }, { 'x-request-id': tokenShaped }),
    );
    expect(response.headers.get('x-request-id')).not.toBe(tokenShaped);
  });
});

describe('a request that is refused', () => {
  it('gives the claim back, so the client can ask again', async () => {
    // The bug this asserts: without the release, the `in_flight` row outlived the
    // refusal and every retry was told `in_progress` — for ever, because
    // retention keeps unfinished rows on purpose.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Refusal('duplicate_name', 'Somebody is using that name.')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'conflict',
      reason: 'duplicate_name',
    });
    expect(called('release_request')).toHaveLength(1);
    expect(called('finish_request')).toHaveLength(0);
  });

  it('reports the refusal even when giving the claim back also fails', async () => {
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      return { data: null, error: new Error('the database is having a moment') };
    };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Refusal('circle_full', 'That circle is full.')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    // The original failure is the one worth reporting; the release failing would
    // only hide why.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'circle_full' });
  });

  it('turns a reason the database raised by name into that reason', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      // What `postgrest-js` hands back for `raise exception 'invite_inactive'`.
      handle: () => Promise.reject(Object.assign(new Error('invite_inactive'), { code: 'P0001' })),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'invite_inactive' });
  });

  it('keeps the claim when the failure could have committed', async () => {
    // A connection lost between Postgres committing and the answer arriving looks
    // exactly like a failure from here. Releasing would let the retry run a
    // mutation that already happened — and a reattachment done twice answers
    // `member_not_found`, because the membership it names has moved.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Error('socket hang up')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(500);
    expect(called('release_request')).toHaveLength(0);
  });

  it('gives it back when the database refused by name', async () => {
    // A named refusal is a statement that the transaction aborted, so the retry
    // is a genuine retry.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(Object.assign(new Error('circle_full'), { code: 'P0001' })),
    });

    await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(called('release_request')).toHaveLength(1);
  });

  it('says nothing about an error it does not recognise', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () =>
        Promise.reject(
          Object.assign(
            new Error('duplicate key value violates "x": Key (email)=(priya@example.com)'),
            {
              code: '23505',
            },
          ),
        ),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    const body = await response.text();

    expect(response.status).toBe(500);
    // A Postgres message can quote the row that caused it (non-negotiable 8).
    expect(body).not.toContain('priya@example.com');
    expect(body).not.toContain('duplicate key');
  });
});

describe('a request whose answer could not be recorded', () => {
  it('still succeeds, and does not give the claim back', async () => {
    // The work has committed by then. Releasing would let a retry run a mutation
    // that already happened — and a reattachment run twice answers
    // `member_not_found`, because the membership it names has moved.
    state.answer = (fn) => {
      if (fn === 'begin_request') {
        return {
          data: [{ state: 'fresh', response_status: null, response_body: null }],
          error: null,
        };
      }
      if (fn === 'finish_request') return { data: null, error: new Error('write failed') };
      return { data: null, error: null };
    };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({ moved: true }),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ moved: true });
    expect(called('release_request')).toHaveLength(0);
  });
});

describe('a retry', () => {
  it('is answered with the response the first attempt gave', async () => {
    state.answer = (fn) =>
      fn === 'begin_request'
        ? {
            data: [{ state: 'done', response_status: 200, response_body: { joined: true } }],
            error: null,
          }
        : { data: null, error: null };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Error('the work must not run again')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ joined: true });
  });

  it('is told to wait while the first attempt is still running', async () => {
    state.answer = (fn) =>
      fn === 'begin_request'
        ? {
            data: [{ state: 'in_flight', response_status: null, response_body: null }],
            error: null,
          }
        : { data: null, error: null };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Error('the work must not run twice at once')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(await response.json()).toMatchObject({ reason: 'in_progress' });
  });

  it('is refused when the key was used for a different body', async () => {
    state.answer = (fn) =>
      fn === 'begin_request'
        ? { data: [{ state: 'mismatch', response_status: null, response_body: null }], error: null }
        : { data: null, error: null };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(await response.json()).toMatchObject({ reason: 'idempotency_mismatch' });
  });
});

describe('what never reaches the handler', () => {
  it('answers a preflight without one', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(new Request('https://example.test/fn', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('apikey');
  });

  it('refuses anything but a POST', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(new Request('https://example.test/fn', { method: 'GET' }));
    expect(response.status).toBe(405);
  });

  it('refuses a request with no bearer token', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(
      new Request('https://example.test/fn', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
    // Nothing was claimed, because nobody was identified.
    expect(called('begin_request')).toHaveLength(0);
  });

  it('refuses a token the auth server will not confirm', async () => {
    state.user = null;
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(response.status).toBe(401);
  });

  it('refuses a body that is not JSON', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(
      new Request('https://example.test/fn', {
        method: 'POST',
        headers: { authorization: 'Bearer a.token' },
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('names the fields it could not use, and never their values', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya Sharma' }));
    const body = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(body.message).toContain('display_name');
    // Zod's own message quotes what it was given, and what it was given is
    // somebody's name (non-negotiable 8).
    expect(body.message).not.toContain('Priya');
  });
});

describe('when the function itself is not in a fit state', () => {
  it('still answers with a Problem, a reference and the CORS headers', async () => {
    // Constructing a client throws when a secret is missing, and that happens
    // before any of the work — so the promise used to reject and the caller got
    // none of the three things this wrapper promises for every answer it gives.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unavailable' });
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('says nothing about which secret is missing', async () => {
    delete process.env.SUPABASE_URL;

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });
    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(await response.text()).not.toContain('SUPABASE_URL');
  });
});

describe('the guard phase', () => {
  it('gives the claim back when it refuses, so the request can be made again', async () => {
    // The guard writes nothing the caller asked for, so there is never anything to
    // protect a retry from — a throttled request must leave the key usable.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      guard: () => Promise.reject(new Refusal('too_many_requests', 'Slow down.')),
      handle: () => Promise.reject(new Error('the work must not run')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(429);
    expect(called('release_request')).toHaveLength(1);
    expect(called('finish_request')).toHaveLength(0);
  });

  it('gives it back even when it fails in a way nobody mapped', async () => {
    // A rate-counter RPC that errors, or a Turnstile fetch that throws. Unlike a
    // failure in `handle`, these cannot have committed anything — so they get no
    // benefit of the doubt and the key is released.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      guard: () => Promise.reject(new Error('the counter is unreachable')),
      handle: () => Promise.resolve({}),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(500);
    expect(called('release_request')).toHaveLength(1);
  });

  it('does not run at all for a retry that has already been answered', async () => {
    // Turnstile tokens are single-use. Running the guard before looking for the
    // recorded response meant a retry of a *successful* web redemption could never
    // be answered: refused as a reused token, or — with a fresh one — as a changed
    // fingerprint.
    state.answer = (fn) =>
      fn === 'begin_request'
        ? {
            data: [{ state: 'done', response_status: 200, response_body: { joined: true } }],
            error: null,
          }
        : { data: null, error: null };

    let guarded = 0;
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      guard: () => {
        guarded += 1;
        return Promise.reject(new Refusal('too_many_requests', 'That token is spent.'));
      },
      handle: () => Promise.reject(new Error('the work must not run again')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ joined: true });
    expect(guarded).toBe(0);
  });

  it('lets the work run when it passes', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      guard: () => Promise.resolve(),
      handle: () => Promise.resolve({ joined: true }),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(await response.json()).toEqual({ joined: true });
    expect(called('begin_request')).toHaveLength(1);
  });
});

describe('what identifies a request', () => {
  const fingerprintOf = () =>
    called('begin_request')[0]?.args['p_fingerprint'] as string | undefined;

  it('ignores the fields a function declares volatile', async () => {
    // A fresh Turnstile token on a retry is the same request asked again, and
    // fingerprinting it turned every honest retry into `idempotency_mismatch`.
    const Web = Body.extend({ turnstile_token: z.string() });
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Web,
      fingerprintExcludes: ['turnstile_token'],
      handle: () => Promise.resolve({}),
    });

    await handler(post({ idempotency_key: KEY, display_name: 'Priya', turnstile_token: 'one' }));
    const first = fingerprintOf();

    state.calls = [];
    await handler(post({ idempotency_key: KEY, display_name: 'Priya', turnstile_token: 'two' }));

    expect(fingerprintOf()).toBe(first);
  });

  it('still notices a different request under the same key', async () => {
    const Web = Body.extend({ turnstile_token: z.string() });
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Web,
      fingerprintExcludes: ['turnstile_token'],
      handle: () => Promise.resolve({}),
    });

    await handler(post({ idempotency_key: KEY, display_name: 'Priya', turnstile_token: 'one' }));
    const first = fingerprintOf();

    state.calls = [];
    await handler(post({ idempotency_key: KEY, display_name: 'Tom', turnstile_token: 'one' }));

    expect(fingerprintOf()).not.toBe(first);
  });
});

describe('telling a refusal from a failure', () => {
  it('gives the claim back when Postgres refused a statement', async () => {
    // A PostgREST error carrying a five-character SQLSTATE is Postgres saying it
    // refused the statement, so the transaction is gone and nothing committed —
    // even when the reason is not one of ours. Treating an unmapped constraint
    // violation as *ambiguous* held the key for ever, and both of round ten's
    // merge bugs ended exactly there.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () =>
        Promise.reject(
          Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          }),
        ),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(500);
    expect(called('release_request')).toHaveLength(1);
  });

  it('still keeps it when the failure carries no SQLSTATE at all', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Error('socket hang up')),
    });

    await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(called('release_request')).toHaveLength(0);
  });

  it('says "ours" rather than "sign in again" when the auth server cannot be asked', async () => {
    // The failure mode this replaces: somebody perfectly well signed in, told to
    // sign in again, about a blip that would have resolved itself.
    state.authError = { message: 'fetch failed' };

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unavailable' });
  });

  it('and "sign in again" when it was asked and said no', async () => {
    state.user = null;

    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.resolve({}),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));
    expect(response.status).toBe(401);
  });
});

describe('a dependency that could not be reached', () => {
  it('gives the claim back and answers 503', async () => {
    // `claim-identity` verifies the replaced session before it calls anything, so a
    // GoTrue blip there means nothing was done — and a bare `Error` made the wrapper
    // keep the claim, so every retry of saving your place said `in_progress` for the
    // life of the row. On the conversion path, for a problem that fixes itself.
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Unavailable('That could not be confirmed just now.')),
    });

    const response = await handler(post({ idempotency_key: KEY, display_name: 'Priya' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unavailable' });
    expect(called('release_request')).toHaveLength(1);
  });

  it('says nothing a caller could mistake for their own fault', async () => {
    const handler = jsonHandler({
      name: 'test-fn',
      schema: Body,
      handle: () => Promise.reject(new Unavailable()),
    });

    const body = (await (
      await handler(post({ idempotency_key: KEY, display_name: 'Priya' }))
    ).json()) as { reason?: string };

    // No `reason`: there is nothing for a screen to branch on, and nothing for the
    // person to do but try again.
    expect(body.reason).toBeUndefined();
  });
});
