import type { z } from 'zod';

import { type Actor, bearerOf, identify } from './auth.ts';
import { asService, type Db } from './db.ts';
import { log } from './logging.ts';
import { plainProblem, problemOf } from './problem.ts';
import { CORS, reference, respond } from './respond.ts';

/**
 * The skeleton for a function that **records** rather than decides.
 *
 * `track-events` is the only one today, and it is unlike the other four in two
 * ways that both come from the same fact: the caller is a browser that may have
 * no account at all.
 *
 * **The actor is optional.** A link opened from a group chat is measured before
 * anybody has joined anything — `circle_join_opened` is the top of the funnel
 * and by definition precedes a session. A bearer that is not a user token (the
 * publishable key, which is what `supabase-js` sends when there is no session,
 * or a JWT that expired while the tab was open) is therefore not a refusal: it
 * is an event with no `user_id`, which is exactly what `anonymous_id` is for.
 * An auth server that cannot be *asked*, though, is a 503 — the client keeps
 * the batch and tries again, and the attribution survives the outage rather
 * than being quietly thrown away.
 *
 * **There is no idempotency claim.** A claim is keyed to a user and there is
 * often no user; and the thing a claim protects against is a mutation running
 * twice, which is not the shape of this at all. What protects this is narrower
 * and lives in the data: every event carries an id, and the insert is `on
 * conflict do nothing`. A resent batch is the same batch.
 */
export interface Ingesting<Body> {
  body: Body;
  /** Present only when the bearer was a real user token. */
  actor: Actor | undefined;
  /** Bypasses RLS: `analytics.events` grants the service role insert and nothing else. */
  service: Db;
  request: Request;
  requestId: string;
}

interface IngestSpec<Schema extends z.ZodType> {
  name: string;
  schema: Schema;
  guard?: (context: Ingesting<z.infer<Schema>>) => Promise<void>;
  handle: (context: Ingesting<z.infer<Schema>>) => Promise<unknown>;
}

export function ingestHandler<Schema extends z.ZodType>(
  spec: IngestSpec<Schema>,
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

    try {
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
        // Field names only. A payload here is a measurement, but the *names* of
        // the fields are the catalogue's and the values are not ours to echo.
        const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))]
          .filter((field) => field !== '')
          .sort()
          .slice(0, 10)
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

      const service = asService();

      let actor: Actor | undefined;
      const bearer = bearerOf(request.headers.get('Authorization'));
      if (bearer !== undefined) {
        const identified = await identify(service, bearer);
        if (identified.outcome === 'unavailable') {
          return fail(
            plainProblem('unavailable', 503, 'Something went wrong at our end.', requestId),
          );
        }
        if (identified.outcome === 'actor') actor = identified.actor;
      }

      const context: Ingesting<z.infer<Schema>> = {
        body: parsed.data,
        actor,
        service,
        request,
        requestId,
      };

      if (spec.guard !== undefined) await spec.guard(context);

      const result = await spec.handle(context);

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
