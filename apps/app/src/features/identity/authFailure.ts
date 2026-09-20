import { isOffline } from './join/failure';

/** How the auth server says no, read by its code rather than its words. */
export function authFailure(error: unknown): 'offline' | 'wrong_code' | 'too_many' | 'other' {
  if (isOffline() || (error as { name?: string })?.name === 'AuthRetryableFetchError') {
    return 'offline';
  }
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
  return 'other';
}
