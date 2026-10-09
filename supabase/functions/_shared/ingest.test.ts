import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Who `ingestHandler` asks the auth server about.
 *
 * The publishable key is not a user token, so asking GoTrue about it is a round
 * trip that can only say no. The rule these tests hold in place: skipping that
 * trip means "nobody", and nothing else. A real token is still identified, and a
 * bearer that merely resembles the key is not the key.
 */

const state = vi.hoisted(() => ({
  getUserCalls: [] as string[],
  user: { id: '00000000-0000-4000-8000-00000000user', is_anonymous: false } as {
    id: string;
    is_anonymous: boolean;
  } | null,
  failure: null as { name: string; status: number } | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: (token: string) => {
        state.getUserCalls.push(token);
        if (state.failure !== null) {
          return Promise.resolve({
            data: { user: null },
            error: Object.assign(new Error('timed out'), state.failure),
          });
        }
        return Promise.resolve(
          state.user === null
            ? { data: { user: null }, error: Object.assign(new Error('no'), { status: 401 }) }
            : { data: { user: state.user }, error: null },
        );
      },
    },
  }),
}));

const { ingestHandler } = await import('./ingest.ts');

const ANON = 'sb-publishable-anon-key-for-tests';

function post(bearer?: string): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ n: 1 }),
  });
}

function recorder() {
  const seen: { actor: unknown }[] = [];
  const handler = ingestHandler({
    name: 'test-ingest',
    schema: z.object({ n: z.number() }),
    handle: (context) => {
      seen.push({ actor: context.actor });
      return Promise.resolve({ ok: true });
    },
  });
  return { seen, handler };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.test';
  process.env.SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  state.getUserCalls = [];
  state.failure = null;
  state.user = { id: '00000000-0000-4000-8000-00000000user', is_anonymous: false };
});

describe('a batch sent with the publishable key', () => {
  it('is accepted as nobody, without asking the auth server', async () => {
    const { seen, handler } = recorder();

    const response = await handler(post(ANON));

    expect(response.status).toBe(200);
    expect(seen).toEqual([{ actor: undefined }]);
    expect(state.getUserCalls).toEqual([]);
  });
});

describe('everything that is not exactly the publishable key', () => {
  it('still identifies a real user token', async () => {
    const { seen, handler } = recorder();

    const response = await handler(post('a.real.token'));

    expect(response.status).toBe(200);
    expect(state.getUserCalls).toEqual(['a.real.token']);
    expect(seen).toEqual([
      { actor: { userId: '00000000-0000-4000-8000-00000000user', isAnonymous: false } },
    ]);
  });

  it.each([
    ['a prefix of the key', ANON.slice(0, -1)],
    ['the key with something after it', `${ANON}x`],
    ['the key in another case', ANON.toUpperCase()],
  ])('asks about %s, and a rejection leaves nobody', async (_name, bearer) => {
    state.user = null;
    const { seen, handler } = recorder();

    const response = await handler(post(bearer));

    expect(response.status).toBe(200);
    expect(state.getUserCalls).toEqual([bearer]);
    expect(seen).toEqual([{ actor: undefined }]);
  });

  it('identifies a user token when the key is not configured at all', async () => {
    delete process.env.SUPABASE_ANON_KEY;
    const { handler } = recorder();

    await handler(post('a.real.token'));

    expect(state.getUserCalls).toEqual(['a.real.token']);
  });

  it('answers 503 when the auth server cannot be reached, rather than recording nobody', async () => {
    state.failure = { name: 'AuthRetryableFetchError', status: 0 };
    const { seen, handler } = recorder();

    const response = await handler(post('a.real.token'));

    expect(response.status).toBe(503);
    expect(seen).toEqual([]);
  });

  it('accepts a request with no bearer, as before', async () => {
    const { seen, handler } = recorder();

    const response = await handler(post());

    expect(response.status).toBe(200);
    expect(seen).toEqual([{ actor: undefined }]);
    expect(state.getUserCalls).toEqual([]);
  });
});
