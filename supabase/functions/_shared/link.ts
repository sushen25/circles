import type { z } from 'zod';

import { asService, type Db } from './db.ts';
import { log } from './logging.ts';
import { plainProblem, problemOf } from './problem.ts';
import { CORS, reference, respond } from './respond.ts';

/**
 * The skeleton for a function a **link** authorises.
 *
 * `/v/:token` and `/e/:token` are opened by somebody who may have no account,
 * no session and no memory of the circle — reading an email on a borrowed
 * phone, three months after the fact. Requiring a JWT would make "stop these
 * emails" need a sign-in, which the Spam Act answer and spec §5.8 both say it
 * must not.
 *
 * So there is no actor here at all. The token in the body is the whole of the
 * authorisation: ≥256 bits, hashed in the database, single-use or expiring by
 * purpose (§14). Everything it can reach is scoped to the one contact it was
 * issued for, and the functions it calls are `service_role` only — this wrapper
 * is the only door, and the token is the key.
 *
 * No idempotency record either, and that is deliberate rather than forgotten: a
 * claim is keyed to a user, and there is no user. A verification token is
 * single-use by design ("two clicks on one link cannot both succeed"), so the
 * second attempt is *supposed* to say the link is spent.
 */
export interface LinkHandling<Body> {
  body: Body;
  /** The only client: nobody is signed in, so RLS has nobody to answer about. */
  service: Db;
  request: Request;
  requestId: string;
}

interface LinkSpec<Schema extends z.ZodType> {
  name: string;
  schema: Schema;
  handle: (context: LinkHandling<z.infer<Schema>>) => Promise<unknown>;
}

export function linkHandler<Schema extends z.ZodType>(
  spec: LinkSpec<Schema>,
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
    if (request.method !== 'POST') {
      return fail(plainProblem('invalid_request', 405, 'That address takes a POST.', requestId));
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return fail(
        plainProblem('invalid_request', 400, 'That request was not readable.', requestId),
      );
    }

    const parsed = spec.schema.safeParse(raw);
    if (!parsed.success) {
      // Field names only. The field here is called `token`, and its *value* is
      // the one thing in the product that must never reach a log (§14).
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
        .filter((field) => field !== '')
        .sort()
        .join(', ');
      return fail(
        plainProblem(
          'invalid_request',
          400,
          fields === '' ? 'That link was not usable.' : `Not usable: ${fields}.`,
          requestId,
        ),
      );
    }

    try {
      const result = await spec.handle({
        body: parsed.data,
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
      return respond(200, result, requestId);
    } catch (thrown) {
      const problem = problemOf(thrown, requestId);
      return fail(problem, problem.code);
    }
  };
}
