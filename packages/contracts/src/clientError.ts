/**
 * The vocabulary of a crash report (SUS-112), split from the catalogue so that
 * `analytics.ts` stays under the file-size rule (non-negotiable 10). The event
 * itself is declared in `analytics.ts`, as every event is.
 */

/**
 * What `client_error` may say about a crash (SUS-112). Every field is a fixed
 * list or a pattern too narrow to hold words, and the patterns are held to
 * what `jobs.carries_content` lets into `analytics.events.properties`: at most
 * 40 characters of `[A-Za-z0-9_./:+-]`. A value outside that does not fail
 * softly, it makes `record_events` raise and takes the whole batch of fifty
 * with it, so these are not "nice to have" bounds.
 *
 * - `route` — the route's *file path*, never the address: `/p/:code`, not
 *   `/p/K7QM2X`. A dynamic segment is `:name` (the file's `[name]`, whose
 *   brackets the content check refuses), and a group like `(auth)` is not in
 *   the address and not in the pattern. `/` stands for the root.
 * - `reference` — eight characters from an alphabet with no look-alikes, so a
 *   person can read it out. Minted on the device, never derived from anything.
 * - `build` — a commit (7 to 40 hex digits) or `dev`.
 */
export const CLIENT_ERROR_CLASSES = [
  'type_error',
  'reference_error',
  'range_error',
  'syntax_error',
  'chunk_load',
  'other',
] as const;
export type ClientErrorClass = (typeof CLIENT_ERROR_CLASSES)[number];

/** Where it was caught: the screen's boundary, or the window's two listeners. */
export const CLIENT_ERROR_SOURCES = ['boundary', 'window_error', 'unhandled_rejection'] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

/**
 * Every word a route's path is made of, and every parameter it names. A route
 * is stored only if each of its segments is one of these (or `:other`, or
 * `+not-found`), so `/p/:code` is a pattern and `/nina` or `/p/k7qm2x` is
 * refused: the regex below bounds the *alphabet*, and only a list can tell a
 * screen's name from somebody's. A new route adds its word here; the app's
 * `clientError.test.ts` fails until it does.
 */
export const CLIENT_ERROR_ROUTE_WORDS = [
  'a',
  'account',
  'after',
  'analytics',
  'another',
  'attendance',
  'brand',
  'calendar',
  'cancel',
  'cancelled',
  'candidates',
  'change-time',
  'check-email',
  'circles',
  'code',
  'components',
  'confirmed',
  'continue',
  'create',
  'deadline',
  'denied',
  'diagnostics',
  'e',
  'edit',
  'edit-locked',
  'empty',
  'expired',
  'finish',
  'founder',
  'gallery',
  'gate',
  'get-the-app',
  'interest',
  'invalid',
  'invite',
  'j',
  'join',
  'mode',
  'n',
  'name',
  'new',
  'no-quorum',
  'none',
  'notifications',
  'nudge',
  'offline',
  'og',
  'opened',
  'outcome',
  'overlay',
  'p',
  'pick',
  'plan',
  'privacy',
  'push',
  'quiet',
  'rejoined',
  'rescheduled',
  'review',
  'save',
  'save-access',
  'sent',
  'sent-again',
  'set-time',
  'settings',
  'setup',
  'shared',
  'sign-in',
  'start',
  'terms',
  'threshold',
  'v',
  'volunteer',
  'waiting',
  'welcome',
  'window',
] as const;
export const CLIENT_ERROR_ROUTE_PARAMS = ['id', 'kind', 'planId', 'code', 'other'] as const;

const ROUTE_SEGMENT = '(?:[a-z0-9-]+|:[A-Za-z]+|\\+[a-z-]+)';
export const CLIENT_ERROR_ROUTE = new RegExp(`^/(?:${ROUTE_SEGMENT}(?:/${ROUTE_SEGMENT})*)?$`);
export function isKnownRoute(route: string): boolean {
  const words: readonly string[] = CLIENT_ERROR_ROUTE_WORDS;
  const params: readonly string[] = CLIENT_ERROR_ROUTE_PARAMS;
  return route
    .split('/')
    .slice(1)
    .filter((segment) => segment !== '')
    .every((segment) =>
      segment.startsWith(':')
        ? params.includes(segment.slice(1))
        : segment === '+not-found' || words.includes(segment),
    );
}

/** Eight characters, no `0 O 1 I`, so it can be read out over the phone. */
export const CLIENT_ERROR_REFERENCE = /^[2-9A-HJ-NP-Z]{8}$/;
export const CLIENT_ERROR_BUILD = /^(?:[0-9a-f]{7,40}|dev)$/;
