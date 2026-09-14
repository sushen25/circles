import type { z } from 'zod';

import { bearerOf } from './auth.ts';
import { asService, type Db } from './db.ts';
import { optional } from './env.ts';
import { log } from './logging.ts';
import { plainProblem, problemOf } from './problem.ts';
import { CORS, reference, respond } from './respond.ts';

/**
 * The skeleton for a function no person calls.
 *
 * `jsonHandler`'s shape is built around a caller: a verified user, an
 * idempotency key belonging to them, rate limits keyed to them. An internal
 * endpoint has none of those — architecture §9.1 marks `recalculate-candidates`
 * and `process-scheduled-jobs` as internal, and the bearer they carry is
 * `CRON_SECRET`, the shared value the database's `jobs.invoke_*` functions send
 * and the runbook sets alongside `circles.cron_secret`.
 *
 * A separate wrapper rather than a mode on the other one, because every step
 * that differs is a step `jsonHandler` must *not* take: `getUser` on a secret is
 * a round trip that can only fail, an idempotency claim needs a user to belong
 * to, and an actor that does not exist would have to be invented for the
 * context. What they share — the reference, the CORS headers, the PII-free log
 * line, and turning a thrown value into a `Problem` — is shared as code
 * (`problemOf`), not by pretending the two are one shape.
 *
 * **Off until configured.** With no `CRON_SECRET` set, every call is refused:
 * an internal endpoint that anybody can reach because a secret is missing is
 * worse than one nobody can reach.
 */
export interface InternalHandling<Body> {
  body: Body;
  /** There is no caller, so there is only the service client. */
  service: Db;
  request: Request;
  requestId: string;
}

interface InternalSpec<Schema extends z.ZodType> {
  name: string;
  schema: Schema;
  handle: (context: InternalHandling<z.infer<Schema>>) => Promise<unknown>;
}

/** Constant-time, so a wrong bearer cannot be narrowed by how long it took. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  // Lengths are compared as data too: returning early on a length mismatch is
  // the timing leak this function exists to avoid.
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function internalHandler<Schema extends z.ZodType>(
  spec: InternalSpec<Schema>,
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

    const secret = optional('CRON_SECRET');
    const token = bearerOf(request.headers.get('authorization'));
    if (secret === undefined || token === undefined || !sameSecret(token, secret)) {
      // The same answer for "no secret configured", "no bearer" and "wrong
      // bearer": which of the three it was is ours to know from the logs, and
      // telling them apart would say whether the endpoint is armed.
      return fail(
        plainProblem('unauthorised', 401, 'Not something you can call.', requestId),
        secret === undefined ? 'unconfigured' : 'bad_secret',
      );
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
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
        .filter((field) => field !== '')
        .sort()
        .join(', ');
      return fail(
        plainProblem(
          'invalid_request',
          400,
          fields === '' ? 'That request was not usable.' : `Not usable: ${fields}.`,
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
