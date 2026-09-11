import type { z } from 'zod';

import { type Actor, actorFrom, bearerOf } from './auth.ts';
import { asCaller, asService, type Db } from './db.ts';
import { claim, record } from './idempotency.ts';
import { log } from './logging.ts';
import { plainProblem, problemFor, reasonOf, Refusal } from './problem.ts';

/**
 * The skeleton every function follows (architecture §7.4), as one wrapper.
 *
 * Parse, authenticate, claim the idempotency key, run the use case, record the
 * answer, and turn anything that goes wrong into a `Problem` with a reference
 * the person can read back to us. A function that writes this itself is a
 * function that will write it slightly differently.
 *
 * What it deliberately does *not* do is decide anything. Every rule lives in
 * the database, and the handler below is orchestration — if a handler grows a
 * judgement about who may do what, that judgement is in the wrong file.
 */

export interface Handling<Body> {
  body: Body;
  actor: Actor;
  /** Carries the caller's JWT: `auth.uid()` is them, and RLS applies. */
  caller: Db;
  /** Bypasses RLS. For the kit's own bookkeeping, and for nothing casual. */
  service: Db;
  request: Request;
  requestId: string;
}

interface Spec<Schema extends z.ZodType> {
  /** The function's own name, as the folder and the idempotency record use it. */
  name: string;
  schema: Schema;
  handle: (context: Handling<z.infer<Schema>>) => Promise<unknown>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id, x-circles-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * A reference a person can read out, and nothing else. An id the client sent is
 * accepted only if it *looks* like an id — an arbitrary header would otherwise
 * be echoed into a log, and the whole point of logging the reference instead of
 * the person is that its contents are known.
 */
function referenceFor(request: Request): string {
  const given = request.headers.get('x-request-id');
  return given !== null && /^[A-Za-z0-9_-]{1,64}$/.test(given) ? given : crypto.randomUUID();
}

function respond(status: number, body: unknown, requestId: string): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', 'x-request-id': requestId },
  });
}

export function jsonHandler<Schema extends z.ZodType>(
  spec: Spec<Schema>,
): (request: Request) => Promise<Response> {
  return async function serve(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId = referenceFor(request);

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

    const authorization = request.headers.get('authorization');
    const token = bearerOf(authorization);
    if (token === undefined || authorization === null) {
      return fail(plainProblem('unauthorised', 401, 'Sign in and try again.', requestId));
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
      // The field names, never the values. A Zod message quotes what it was
      // given, and what it was given is a display name or a token
      // (non-negotiable 8).
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

    const caller = asCaller(authorization);
    const service = asService();

    const actor = await actorFrom(caller, token);
    if (actor === undefined) {
      return fail(plainProblem('unauthorised', 401, 'Sign in and try again.', requestId));
    }

    const body = parsed.data as { idempotency_key?: string };
    const key = body.idempotency_key;

    try {
      if (key !== undefined) {
        const replayed = await claim(
          service,
          spec.name,
          actor.userId,
          key as Parameters<typeof claim>[3],
          parsed.data,
        );
        if (replayed !== undefined) {
          log('info', {
            fn: spec.name,
            request_id: requestId,
            event: 'replayed',
            status: replayed.status,
            duration_ms: Date.now() - started,
          });
          return respond(replayed.status, replayed.body, requestId);
        }
      }

      const result = await spec.handle({
        body: parsed.data,
        actor,
        caller,
        service,
        request,
        requestId,
      });

      if (key !== undefined) {
        await record(
          service,
          spec.name,
          actor.userId,
          key as Parameters<typeof record>[3],
          200,
          result,
        );
      }

      log('info', {
        fn: spec.name,
        request_id: requestId,
        event: 'handled',
        status: 200,
        duration_ms: Date.now() - started,
      });
      return respond(200, result, requestId);
    } catch (thrown) {
      const refusal =
        thrown instanceof Refusal
          ? thrown.reason
          : reasonOf(thrown as { message?: string } | undefined);

      if (refusal !== undefined) {
        const message = thrown instanceof Refusal ? thrown.message : 'That did not work out.';
        return fail(problemFor(refusal, message, requestId), refusal);
      }

      // Nothing from the thrown value reaches the response or the log except a
      // SQLSTATE. A Postgres error message can quote the row that caused it.
      const code = (thrown as { code?: string } | undefined)?.code;
      log('error', {
        fn: spec.name,
        request_id: requestId,
        event: 'failed',
        status: 500,
        reason: typeof code === 'string' ? code : 'unknown',
        duration_ms: Date.now() - started,
      });
      return respond(
        500,
        plainProblem('unavailable', 500, 'Something went wrong at our end.', requestId).body,
        requestId,
      );
    }
  };
}
