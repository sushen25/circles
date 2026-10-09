import { afterEach, describe, expect, it, vi } from 'vitest';

import { asService, DB_TIMEOUT_MS, timeBounded } from './db.ts';

/** The fetch every Supabase client is given: nothing waits longer than ten seconds. */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('timeBounded', () => {
  it('adds a signal to a call that has none', async () => {
    const stub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', stub);

    await timeBounded('https://example.test/rest/v1/rpc/x', { method: 'POST' });

    const init = (stub.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the signal a caller brought', async () => {
    const stub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', stub);
    const own = new AbortController().signal;

    await timeBounded('https://example.test/x', { signal: own });

    expect((stub.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(own);
  });

  it('aborts a call that never answers once the timeout has passed', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted === true) reject(init.signal.reason);
          }),
      ),
    );

    await expect(timeBounded('https://example.test/x')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(timeout).toHaveBeenCalledWith(DB_TIMEOUT_MS);
    timeout.mockRestore();
  });
});

describe('through the real client', () => {
  it('makes one request and returns an error when PostgREST never answers, with no retries', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const stub = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted === true) reject(init.signal.reason);
        }),
    );
    vi.stubGlobal('fetch', stub);

    const started = Date.now();
    const { error } = await asService().from('plans').select('id');

    expect(error).not.toBeNull();
    expect(stub).toHaveBeenCalledTimes(1);
    // The SDK's retry back-off alone is seconds; giving up at once is well under one.
    expect(Date.now() - started).toBeLessThan(1_000);
    timeout.mockRestore();
  });
});
