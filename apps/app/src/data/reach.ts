/**
 * Did the request reach the server? The one place that answers (SUS-200).
 *
 * "You're offline" is a claim about the person's connection, so it is made only
 * when the request never got an answer: the device says it has no network, or
 * the call failed before anything came back. A server that answered, with a 500
 * included, is not offline, and telling someone to "connect, then try again"
 * when the server is the problem sends them to fix the wrong thing.
 *
 * Every screen that maps a failure to "offline" asks `neverReachedServer` and
 * nothing else. It reads the error's *shape* (its name and its status), never
 * its message: a message is where an address or a code ends up.
 */

/** The device's own word: false only when the browser says there is no network. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * `unreached` — no answer came back. `answered` — the server said something,
 * whether a refusal or a 5xx. `unknown` — an error with nothing to tell the two
 * apart, which is never reported as offline.
 */
export type Reach = 'unreached' | 'answered' | 'unknown';

type Shape = { name?: unknown; status?: unknown; message?: unknown; unreached?: unknown };

/** The supabase-js and fetch failures that come with no response at all. */
const FETCH_FAILURE_NAMES: ReadonlySet<string> = new Set([
  // auth-js, when fetch itself threw (status 0), or the answer was a 5xx
  // (status 500 and up): told apart by `status` below.
  'AuthRetryableFetchError',
  // functions-js, when fetch itself threw.
  'FunctionsFetchError',
]);

export function reachOf(error: unknown): Reach {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { name, status, message, unreached } = error as Shape;

  // Our own `FunctionError` records whether the call failed before an answer.
  if (name === 'FunctionError') return unreached === true ? 'unreached' : 'answered';

  if (typeof name === 'string' && FETCH_FAILURE_NAMES.has(name)) {
    if (name === 'AuthRetryableFetchError') {
      // auth-js uses this class for a 5xx too. Status 0 is "fetch threw".
      return typeof status === 'number' && status > 0 ? 'answered' : 'unreached';
    }
    return 'unreached';
  }

  // Any other error that carries an HTTP status came from a response.
  if (typeof status === 'number' && status > 0) return 'answered';

  // A browser's own failed fetch: `TypeError: Failed to fetch` (and its Safari
  // and Firefox spellings). Recognised by name and phrase, copied nowhere.
  if (
    name === 'TypeError' &&
    typeof message === 'string' &&
    /failed to fetch|load failed|networkerror|network request failed/i.test(message)
  ) {
    return 'unreached';
  }
  return 'unknown';
}

/** The rule: say "offline" only for this. */
export function neverReachedServer(error: unknown): boolean {
  return isOffline() || reachOf(error) === 'unreached';
}
