import type { z } from 'zod';

import { bearerOf, identify, type Actor } from './auth.ts';
import { asCaller, asService, type Db } from './db.ts';
import { log } from './logging.ts';
import { plainProblem, problemOf } from './problem.ts';
import { CORS, reference, respond } from './respond.ts';

/**
 * The skeleton for a function that answers with a file.
 *
 * `jsonHandler` is a POST that returns JSON and claims an idempotency key, which
 * is three things a download is not: `generate-ics` is a **GET**, because a
 * browser has to be able to navigate to it, and what comes back is
 * `text/calendar` with a `Content-Disposition` rather than a body a client
 * parses. Nothing is written, so there is no key to claim and no retry to
 * protect.
 *
 * What it keeps is everything that makes an answer ours: the same
 * authentication, the same reference on a failure, the same PII-free log line,
 * and the same `Problem` shape when something goes wrong — `problemOf`, shared
 * as code rather than by pretending a file and a JSON object are one thing.
 */
export interface DownloadHandling<Query> {
  query: Query;
  actor: Actor;
  /** Carries the caller's JWT: RLS decides what they may download. */
  caller: Db;
  service: Db;
  request: Request;
  requestId: string;
}

export interface Download {
  body: string;
  /** With its charset: a calendar file is not ASCII and a name can hold anything. */
  contentType: string;
  filename: string;
  /**
   * Seconds a browser may reuse the answer for. **Zero means `no-store`**, not
   * "stale immediately": a file describing something that can be cancelled is
   * worth re-fetching, and a cache that serves the old one is wrong about when
   * somebody is meeting.
   */
  maxAge: number;
}

interface DownloadSpec<Schema extends z.ZodType> {
  name: string;
  /** Parses the query string. A GET has no body to validate. */
  schema: Schema;
  handle: (context: DownloadHandling<z.infer<Schema>>) => Promise<Download>;
}

export function downloadHandler<Schema extends z.ZodType>(
  spec: DownloadSpec<Schema>,
): (request: Request) => Promise<Response> {
  return async function serve(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId = reference();

    const fail = (problem: { status: number; body: unknown }, reason?: string): Response => {
      log(problem.status >= 500 ? 'error' : 'warn', {
        fn: spec.name,
        request_id: requestId,
        event: problem.status >= 500 ? 'failed' : 'refused',
        status: problem.status,
        reason,
        duration_ms: Date.now() - started,
      });
      return respond(problem.status, problem.body, requestId);
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') {
      return fail(plainProblem('invalid_request', 405, 'That address takes a GET.', requestId));
    }

    const authorization = request.headers.get('authorization');
    const token = bearerOf(authorization);
    if (token === undefined || authorization === null) {
      return fail(plainProblem('unauthorised', 401, 'Sign in and try again.', requestId));
    }

    const parsed = spec.schema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      // The field names, never the values — a query string is as much a place
      // for something private as a body is (non-negotiable 8).
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
        .filter((field) => field !== '')
        .sort()
        .join(', ');
      return fail(
        plainProblem(
          'invalid_request',
          400,
          fields === '' ? 'That address was not usable.' : `Not usable: ${fields}.`,
          requestId,
        ),
      );
    }

    try {
      // Inside the try, because both of these can fail before any handler runs:
      // constructing a client throws when a secret is missing, and `getUser`
      // rejects on a transient network failure. Outside it, the promise simply
      // rejected — no `Problem`, no reference, no CORS headers, which is the
      // one thing every wrapper here promises for every answer it gives.
      const caller = asCaller(authorization);
      const identified = await identify(caller, token);
      if (identified.outcome === 'unavailable') {
        return fail(
          plainProblem('unavailable', 503, 'Something went wrong at our end.', requestId),
        );
      }
      if (identified.outcome === 'rejected') {
        return fail(plainProblem('unauthorised', 401, 'Sign in and try again.', requestId));
      }

      const file = await spec.handle({
        query: parsed.data,
        actor: identified.actor,
        caller,
        service: asService(),
        request,
        requestId,
      });

      log('info', {
        fn: spec.name,
        request_id: requestId,
        event: 'handled',
        status: 200,
        duration_ms: Date.now() - started,
      });

      return new Response(file.body, {
        status: 200,
        headers: {
          ...CORS,
          'content-type': file.contentType,
          // The filename is quoted and ASCII by construction (`icsFilename`
          // slugs it), so there is no header injection to worry about and no
          // `filename*` encoding to get wrong.
          'content-disposition': `attachment; filename="${file.filename}"`,
          'cache-control': file.maxAge === 0 ? 'no-store' : `private, max-age=${file.maxAge}`,
          'x-request-id': requestId,
        },
      });
    } catch (thrown) {
      const problem = problemOf(thrown, requestId);
      return fail(problem, problem.code);
    }
  };
}
