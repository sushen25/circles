import { useMemo } from 'react';

import { reportClientError } from '../../analytics/clientError';

/**
 * A reference a request id may be shown as. Only a UUID, which is what the Edge
 * Functions mint (`reference()` in `_shared/respond.ts`). Anything else (a plan
 * code, an address, a token, a sentence) is not a reference and is never shown,
 * so a caller that passes the wrong thing cannot put it on a screen (SUS-200,
 * privacy invariants).
 */
const SHOWABLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function showableReference(value: string | undefined): string | undefined {
  return value !== undefined && SHOWABLE.test(value) ? value : undefined;
}

/**
 * The reference an error screen shows (SUS-200).
 *
 * - A request id the Edge Functions logged (`given`, a `FunctionError`'s
 *   `reference`) is used as it is, when there is one.
 * - Otherwise one is made on the device and sent with a `client_error` report
 *   (`load_failed`, SUS-112's channel), so a line in the logs carries it. The
 *   report holds the screen's route pattern and nothing else (`clientError.ts`).
 *
 * `active` is false while the screen is loading or fine, so nothing is made or
 * sent until there is an error to show. A repeat of the same failure in the
 * session returns the first reference (`reportClientError` de-duplicates), so
 * it stays put across retries.
 */
export function useFailureReference(active: boolean, given?: string): string | undefined {
  const usable = showableReference(given);
  // Reported while rendering, once, as the crash screen does: the screen shows
  // the reference it was reported under on its first paint, and the report is
  // idempotent per route, so a strict-mode double render makes no second one.
  return useMemo(
    () => (active ? (usable ?? reportClientError('load_failed', undefined)) : undefined),
    [active, usable],
  );
}
