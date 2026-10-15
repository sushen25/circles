import { reportClientError } from '../../analytics/clientError';
import { neverReachedServer, reachOf } from '../../data/reach';

/**
 * How the auth server says no, read by its code rather than its words.
 *
 * `offline` is `neverReachedServer`, the one rule (`data/reach.ts`): auth-js
 * wraps a 5xx in the same class as a dropped connection, so the class alone
 * would blame the person's network for the server's fault (SUS-200). `server` is
 * the answer that came back as a 5xx.
 */
export function authFailure(
  error: unknown,
): 'offline' | 'server' | 'wrong_code' | 'too_many' | 'other' {
  if (neverReachedServer(error)) return 'offline';
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit'
  ) {
    return 'too_many';
  }
  if (code === 'otp_expired' || code === 'invalid_credentials' || status === 403) {
    return 'wrong_code';
  }
  if (reachOf(error) === 'answered' && typeof status === 'number' && status >= 500) return 'server';
  return 'other';
}

/**
 * The short reference to put under a failure the person did not cause (SUS-200):
 * the server answered with a 5xx or something we do not read, so there is
 * nothing for them to fix and the founder needs a way to find it.
 *
 * It is a client-made id sent with a `client_error` report, so a log line
 * carries it; the auth server's own request id is not handed to the browser. An
 * offline failure, a rate limit and a wrong code have none: each already says
 * what to do.
 */
export function failureReference(
  failure: ReturnType<typeof authFailure>,
  error: unknown,
): string | undefined {
  return failure === 'server' || failure === 'other'
    ? reportClientError('request_failed', error)
    : undefined;
}
