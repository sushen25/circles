import { Platform } from 'react-native';

import {
  CLIENT_ERROR_BUILD,
  CLIENT_ERROR_ROUTE_PARAMS,
  CLIENT_ERROR_ROUTE_WORDS,
  type ClientErrorClass,
  type ClientErrorSource,
} from '@circles/contracts';

import { track } from './track';

/**
 * A crash, reported to the founder with nothing in it that belongs to anybody
 * (SUS-112, audit H7; architecture §7.6 non-negotiable 8).
 *
 * **The error itself never leaves this file.** What is read from it is its
 * class (`TypeError`, a failed chunk) and what comes out is one of six words.
 * Its message, its stack and its cause are not copied, not truncated, not
 * hashed: a message is where a name, an address or a plan code ends up
 * (`Cannot read properties of undefined (reading 'nina@example.com')`), and
 * there is no length at which that is safe. The address is not read either.
 * The route is the *file's* path, from the router's own segments, so the code
 * in `/p/K7QM2X#key` cannot reach it because it is never in the input.
 *
 * Sentry (SUS-61) replaces the transport and adds what this deliberately does
 * not carry. It does not replace the boundary or the reference on the screen.
 */

/**
 * The words a route's path is made of live in `@circles/contracts`
 * (`CLIENT_ERROR_ROUTE_WORDS`), because the ingest holds a stored route to the
 * same list: a client of any age can send anything, and only a list, not a
 * pattern, tells `/p/:code` from `/nina`. `clientError.test.ts` reads the
 * `app/` directory and fails when a route adds a word or a parameter the list
 * lacks, so it cannot rot into reporting `:other` for a real screen.
 */
export const ROUTE_WORDS: ReadonlySet<string> = new Set(CLIENT_ERROR_ROUTE_WORDS);
const ROUTE_PARAMS: ReadonlySet<string> = new Set(CLIENT_ERROR_ROUTE_PARAMS);

const PARAMETER = /^\[([A-Za-z]+)\]$/;
const REST = /^\[\.\.\.([A-Za-z]+)\]$/;
const GROUP = /^\(.*\)$/;
const SPECIAL = /^\+[a-z-]+$/;

/**
 * The route's file path as the catalogue writes it: `/p/:code`. Built from the
 * router's segments (`useSegments()`), which name the *file that matched* and
 * never the address, so the real value of a parameter is not in the input.
 *
 * `[code]` becomes `:code` because `analytics.events` refuses brackets. A
 * group, `(auth)`, is not in the address and is dropped. Anything that is not
 * a known parameter, a group or a word in `ROUTE_WORDS` becomes `:other`.
 */
export function routePattern(segments: readonly string[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (GROUP.test(segment)) continue;
    const rest = REST.exec(segment);
    if (rest !== null) parts.push(':other');
    else {
      const parameter = PARAMETER.exec(segment);
      if (parameter !== null)
        parts.push(ROUTE_PARAMS.has(parameter[1]!) ? `:${parameter[1]}` : ':other');
      else if (SPECIAL.test(segment) || ROUTE_WORDS.has(segment)) parts.push(segment);
      else parts.push(':other');
    }
  }
  const route = `/${parts.join('/')}`;
  // A pattern the catalogue would refuse is reported as `:other` rather than
  // cut mid-word: a screen whose crash cannot be found by its reference is
  // worse than one reported under a coarser route (review round 2).
  return route.length > 40 ? '/:other' : route;
}

/**
 * The class, from a fixed list. Only the error's `name` decides it, and only
 * the one chunk-loading failure also looks at its text to *recognise* it,
 * which is a test against known phrases and copies none of it.
 */
export function errorClassOf(error: unknown): ClientErrorClass {
  if (typeof error !== 'object' || error === null) return 'other';
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return 'chunk_load';
  if (
    typeof message === 'string' &&
    /Loading (?:CSS )?chunk|Importing a module script failed|dynamically imported module/i.test(
      message,
    )
  ) {
    return 'chunk_load';
  }
  switch (name) {
    case 'TypeError':
      return 'type_error';
    case 'ReferenceError':
      return 'reference_error';
    case 'RangeError':
      return 'range_error';
    case 'SyntaxError':
      return 'syntax_error';
    default:
      return 'other';
  }
}

/** Eight characters from an alphabet with no `0 O 1 I`, so it can be read out. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newReference(): string {
  const bytes = new Uint8Array(8);
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues === 'function') source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  // 32 letters, so a byte's low five bits are uniform.
  return [...bytes].map((byte) => ALPHABET[byte & 31]).join('');
}

/** The commit this bundle was built from, when the build says so. */
function buildId(): string {
  // Written out in full: Expo inlines `process.env.EXPO_PUBLIC_*` by name.
  const raw = process.env.EXPO_PUBLIC_BUILD_ID?.trim().toLowerCase() ?? '';
  return CLIENT_ERROR_BUILD.test(raw) ? raw : 'dev';
}

function platform(): 'web' | 'ios' | 'android' {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}

/**
 * At most this many distinct crashes are sent per session. A render loop
 * throws the same error thousands of times a second, which the de-duplication
 * below already collapses; this is for the loop that throws a different one
 * each time, and so that one broken screen cannot spend `track-events`'s
 * rate limit (600 events a minute per connection) on a tab left open.
 */
export const MAX_CLIENT_ERRORS_PER_SESSION = 5;

/** The route's pattern, as last seen: what a script error reports, having no router. */
let currentRoute = '/';
const sent = new Map<string, string>();
let lastReference: string | null = null;

/** Called by the root layout as it renders, with the router's own segments. */
export function setCurrentRoute(segments: readonly string[]): void {
  currentRoute = routePattern(segments);
}

export function currentRoutePattern(): string {
  return currentRoute;
}

/** Test seam. */
export function resetClientErrors(): void {
  currentRoute = '/';
  sent.clear();
  lastReference = null;
}

/**
 * Report one crash and return the reference to show. **Never throws**: it runs
 * inside an error handler, and an error in the reporter would be a crash in
 * the thing that reports crashes.
 *
 * The same route, class and source is the same crash within a session: it is
 * reported once, and later occurrences return the *first* reference, so the
 * one on the screen is always one the founder can find. Past the cap nothing
 * more is sent and the session's last reference is returned, which at least
 * leads to the session's trail.
 */
export function reportClientError(
  source: ClientErrorSource,
  error: unknown,
  segments?: readonly string[],
): string {
  try {
    // A boundary inside a screen knows which screen it is in, from the router's
    // own focused state. The layout's last write is the screen the person came
    // *from* when a screen throws on its first render (review round 2).
    const route = segments === undefined ? currentRoute : routePattern(segments);
    const errorClass = errorClassOf(error);
    const key = `${route}|${errorClass}|${source}`;

    const known = sent.get(key);
    if (known !== undefined) return known;
    if (sent.size >= MAX_CLIENT_ERRORS_PER_SESSION) return lastReference ?? newReference();

    const reference = newReference();
    sent.set(key, reference);
    lastReference = reference;
    track('client_error', {
      route,
      error_class: errorClass,
      source,
      build: buildId(),
      platform: platform(),
      reference,
    });
    return reference;
  } catch {
    return newReference();
  }
}

/**
 * Web only: what the boundary cannot see. An error thrown in an event handler
 * or a timer, and a promise nobody awaited, never reach a render, so the
 * screen carries on and the founder would hear nothing. Returns the teardown.
 *
 * The event's own fields are read for the error and nothing else: its
 * `message`, `filename` and `lineno` are the page's address and its code.
 */
export function listenForClientErrors(): () => void {
  const target = globalThis as unknown as {
    addEventListener?: (type: string, handler: (event: never) => void) => void;
    removeEventListener?: (type: string, handler: (event: never) => void) => void;
  };
  if (Platform.OS !== 'web' || typeof target.addEventListener !== 'function') return () => {};

  const onError = (event: { error?: unknown }): void => {
    reportClientError('window_error', event.error);
  };
  const onRejection = (event: { reason?: unknown }): void => {
    reportClientError('unhandled_rejection', event.reason);
  };

  target.addEventListener('error', onError as (event: never) => void);
  target.addEventListener('unhandledrejection', onRejection as (event: never) => void);
  return () => {
    target.removeEventListener?.('error', onError as (event: never) => void);
    target.removeEventListener?.('unhandledrejection', onRejection as (event: never) => void);
  };
}
