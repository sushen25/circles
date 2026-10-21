import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetClientErrors } from '../../analytics/clientError';
import { FunctionError } from '../../data/functions';
import { authFailure, failureReference } from './authFailure';
import { failureOf } from './join/failure';

const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));

const named = (name: string, fields: Record<string, unknown> = {}) =>
  Object.assign(new Error('x'), { name, ...fields });

beforeEach(() => {
  track.mockReset();
  resetClientErrors();
});

describe('authFailure and failureOf use one rule for "offline" (SUS-200)', () => {
  it('reads a dropped connection as offline and a 5xx as the server, from the same class', () => {
    expect(authFailure(named('AuthRetryableFetchError', { status: 0 }))).toBe('offline');
    expect(authFailure(named('AuthRetryableFetchError', { status: 500 }))).toBe('server');
    expect(authFailure(named('AuthRetryableFetchError', { status: 504 }))).toBe('server');
  });

  it('keeps the other answers: too many, wrong code, anything else', () => {
    expect(authFailure(named('AuthApiError', { status: 429 }))).toBe('too_many');
    expect(authFailure(named('AuthApiError', { code: 'otp_expired', status: 403 }))).toBe(
      'wrong_code',
    );
    expect(authFailure(named('AuthApiError', { code: 'user_banned', status: 403 }))).toBe(
      'wrong_code',
    );
    expect(authFailure(named('AuthApiError', { status: 422 }))).toBe('other');
  });

  it('gives a function call the same reading: no answer is offline, a 5xx with no body is not', () => {
    expect(failureOf(new FunctionError(undefined, 'x', true)).kind).toBe('offline');
    expect(failureOf(new FunctionError(undefined, 'x')).kind).toBe('unknown');
  });
});

describe('failureReference', () => {
  it('makes one, and reports it, for what the person did not cause', () => {
    for (const failure of ['server', 'other'] as const) {
      resetClientErrors();
      track.mockReset();
      expect(failureReference(failure, named('AuthRetryableFetchError', { status: 500 }))).toMatch(
        /^[2-9A-HJ-NP-Z]{8}$/,
      );
      expect(track).toHaveBeenCalledWith(
        'client_error',
        expect.objectContaining({ source: 'request_failed' }),
      );
    }
  });

  it('makes none where the screen already says what to do', () => {
    for (const failure of ['offline', 'too_many', 'wrong_code'] as const) {
      expect(failureReference(failure, new Error('x'))).toBeUndefined();
    }
    expect(track).not.toHaveBeenCalled();
  });
});
