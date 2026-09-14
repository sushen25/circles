/**
 * What a reply looks like, as distinct from when to send one.
 *
 * Split out of `http.ts` when that file passed four hundred lines: the sequencing —
 * claim, guard, work, record, and which failure gives the key back — is one
 * responsibility, and the headers, the reference and the JSON envelope are another.
 * Non-negotiable 10, which nothing in the gate can see: there is no `max-lines`
 * rule, so this is a thing a reader has to notice.
 */

/**
 * A preflight that omits one header the browser is about to send fails the whole
 * request before the function runs at all — and `supabase-js` sends more than the
 * obvious two. `apikey` carries the publishable key (the SDK's own documentation:
 * "the API key is sent in the `apikey` header"), `x-client-info` its version, and
 * newer releases add `x-supabase-api-version`. These endpoints are web-first, so
 * getting this list wrong breaks the product in a browser while every test on the
 * server passes.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    'authorization',
    'apikey',
    'content-type',
    'x-client-info',
    'x-supabase-api-version',
    'x-request-id',
    'x-circles-platform',
  ].join(', '),
  // `GET` for `generate-ics`, which is a download a browser navigates to. It
  // carries a bearer, so the browser preflights it — and a preflight that does
  // not name the method blocks the request that follows, with nothing in the
  // network tab but a CORS error.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Exported so the suite can assert against the list rather than restating it. */
export const ALLOWED_REQUEST_HEADERS = CORS['Access-Control-Allow-Headers'];

/**
 * A reference a person can read out, minted here and never taken from the
 * caller.
 *
 * It used to accept a client-supplied `X-Request-Id` that matched
 * `^[A-Za-z0-9_-]{1,64}$`, on the reasoning that a shape check made the contents
 * known. It did the opposite: `OpaqueToken` in `packages/contracts` is
 * `^[A-Za-z0-9_-]+$`, so the filter admitted precisely the thing non-negotiable 8
 * forbids in a log — a re-entry token, passed as a header, copied into every line
 * this request writes. A name fits too.
 *
 * Correlation with a client-side id is not worth that, and nothing needed it.
 */
export function reference(): string {
  return crypto.randomUUID();
}

export function respond(status: number, body: unknown, requestId: string): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'x-request-id': requestId },
  });
}
