import { afterEach, describe, expect, it, vi } from 'vitest';

import { FunctionError } from './functions';
import { isOffline, neverReachedServer, reachOf } from './reach';

const named = (name: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error('x'), { name, ...fields });

afterEach(() => vi.unstubAllGlobals());

describe('neverReachedServer: "offline" only when nothing answered (SUS-200)', () => {
  it('is true when the request never left: fetch threw, in auth, in functions, in the browser', () => {
    expect(neverReachedServer(named('AuthRetryableFetchError', { status: 0 }))).toBe(true);
    expect(neverReachedServer(named('FunctionsFetchError'))).toBe(true);
    expect(neverReachedServer(new TypeError('Failed to fetch'))).toBe(true);
    expect(neverReachedServer(new TypeError('Load failed'))).toBe(true);
    expect(neverReachedServer(new FunctionError(undefined, 'x', true))).toBe(true);
  });

  it('is false when the server answered, a 500 included: the sign-in bug', () => {
    // The auth server answered POST /auth/v1/otp with 500; auth-js wraps it in
    // the same class as a dropped connection, with the status the only difference.
    expect(neverReachedServer(named('AuthRetryableFetchError', { status: 500 }))).toBe(false);
    expect(neverReachedServer(named('AuthRetryableFetchError', { status: 503 }))).toBe(false);
    expect(neverReachedServer(named('AuthApiError', { status: 429 }))).toBe(false);
    expect(neverReachedServer(named('FunctionsHttpError'))).toBe(false);
    expect(neverReachedServer(new FunctionError(undefined, 'x'))).toBe(false);
    expect(neverReachedServer({ status: 400, code: '42703' })).toBe(false);
  });

  it('is false for an error that cannot say, and for something that is not an error', () => {
    expect(neverReachedServer(new Error('boom'))).toBe(false);
    expect(neverReachedServer(undefined)).toBe(false);
    expect(neverReachedServer('Failed to fetch')).toBe(false);
    expect(reachOf(new Error('boom'))).toBe('unknown');
  });

  it('is true when the device says it has no network, whatever the error', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOffline()).toBe(true);
    expect(neverReachedServer(new Error('boom'))).toBe(true);
  });

  it('reads the error by name and status, never by its message', () => {
    const error = named('AuthApiError', { message: 'Failed to fetch', status: 500 });
    expect(neverReachedServer(error)).toBe(false);
  });
});
