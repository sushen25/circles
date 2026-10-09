import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Refusal, Unavailable } from './problem.ts';
import { TURNSTILE_TIMEOUT_MS, verifyTurnstile } from './turnstile.ts';

/**
 * The check that guards anonymous web joins, and the two ways it can be absent.
 *
 * Skipping without a secret is right on a laptop and wrong on a deployed
 * project: there, a missing or misnamed secret means §14's protection is gone
 * while every visible sign says it is working — the site key is in the bundle,
 * the widget renders, the token is posted, and nothing verifies it. No error is
 * raised and no log line is written, so the only thing that would ever notice
 * is a test like this one.
 *
 * That was not hypothetical. Until SUS-71 both runbooks named the secret
 * `TURNSTILE_SECRET`, and step 9's own verification compared the stored names
 * against the same wrong name and passed.
 */

const HOSTED = 'https://pcfekupwqrdfryeaqggx.supabase.co';
const LOCAL = 'http://127.0.0.1:54321';

function request(platform?: string): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: platform === undefined ? {} : { 'x-circles-platform': platform },
  });
}

function cloudflareSays(success: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 })),
  );
}

beforeEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET;
  process.env.SUPABASE_URL = LOCAL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a deployed project with no secret', () => {
  it('refuses the join rather than waving it through', async () => {
    process.env.SUPABASE_URL = HOSTED;

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Unavailable);
  });

  it('refuses it even when a token was supplied and looks fine', async () => {
    process.env.SUPABASE_URL = HOSTED;
    cloudflareSays(true);

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Unavailable);
    // And never asked Cloudflare, because it has nothing to ask with.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('catches the secret stored under the name the runbooks used to give', async () => {
    // The real shape of this bug: somebody followed the checklist, the value is
    // set, and the name is one nothing reads.
    process.env.SUPABASE_URL = HOSTED;
    process.env.TURNSTILE_SECRET = 'the-real-secret';

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Unavailable);
  });

  it('still exempts native, which has no widget to have a secret for', async () => {
    process.env.SUPABASE_URL = HOSTED;

    await expect(verifyTurnstile(request('native'), undefined)).resolves.toBeUndefined();
  });
});

describe('a local stack with no secret', () => {
  it('skips, because a kit that refuses every join is a kit nobody can run', async () => {
    await expect(verifyTurnstile(request('web'), undefined)).resolves.toBeUndefined();
  });

  it('skips for a Supabase URL it cannot even parse', async () => {
    process.env.SUPABASE_URL = 'not a url';

    await expect(verifyTurnstile(request('web'), undefined)).resolves.toBeUndefined();
  });
});

describe('with a secret configured', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = HOSTED;
    process.env.TURNSTILE_SECRET_KEY = 'the-real-secret';
  });

  it('asks Cloudflare and accepts a token it likes', async () => {
    cloudflareSays(true);

    await expect(verifyTurnstile(request('web'), 'a-token')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refuses a token Cloudflare rejects', async () => {
    cloudflareSays(false);

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Refusal);
  });

  it('refuses a web caller that brought no token at all', async () => {
    cloudflareSays(true);

    await expect(verifyTurnstile(request('web'), undefined)).rejects.toBeInstanceOf(Refusal);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats a missing platform header as web, so the default is to challenge', async () => {
    cloudflareSays(true);

    await expect(verifyTurnstile(request(), undefined)).rejects.toBeInstanceOf(Refusal);
  });
});

describe('a Cloudflare that does not answer', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = HOSTED;
    process.env.TURNSTILE_SECRET_KEY = 'the-real-secret';
  });

  it('is given five seconds, by a signal on the request', async () => {
    cloudflareSays(true);

    await verifyTurnstile(request('web'), 'a-token');

    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is an outage, not a refusal: the join is released to be retried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }),
    );

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Unavailable);
  });

  it('really does give up when nothing arrives', async () => {
    // The platform's timer is real; what is tested is that the request obeys the signal.
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

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(Unavailable);
    expect(timeout).toHaveBeenCalledWith(TURNSTILE_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('does not hide any other failure behind the same answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('boom');
      }),
    );

    await expect(verifyTurnstile(request('web'), 'a-token')).rejects.toBeInstanceOf(TypeError);
  });
});
