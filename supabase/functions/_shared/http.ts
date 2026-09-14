import type { z } from 'zod';

import { type Actor, bearerOf, identify } from './auth.ts';
import { asCaller, asService, type Db } from './db.ts';
import { claim, record, release } from './idempotency.ts';
import { log } from './logging.ts';
import { outcomeOf, plainProblem, problemOf } from './problem.ts';
import { CORS, reference, respond } from './respond.ts';

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
  /**
   * Abuse controls — Turnstile, rate counters — and nothing that writes.
   *
   * Run after the key is claimed and before the work, and the ordering has been
   * wrong in both directions. Before the claim, a retry of a successful web
   * redemption ran Turnstile again: the tokens are single-use, so the stored
   * response could never be handed back — refused as a reused token, or, with a
   * fresh one, as a changed fingerprint. After the claim without the distinction
   * below, an unreachable rate counter left the key claimed for ever.
   *
   * So: a *replay* is answered before this runs at all, and a failure here always
   * releases the claim, because nothing it does can have committed. Only `handle`
   * gets the benefit of the doubt.
   */
  guard?: (context: Handling<z.infer<Schema>>) => Promise<void>;
  handle: (context: Handling<z.infer<Schema>>) => Promise<unknown>;
  /** Body fields that are not part of the request's identity — see `claim`. */
  fingerprintExcludes?: readonly string[];
}

export function jsonHandler<Schema extends z.ZodType>(
  spec: Spec<Schema>,
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

    try {
      return await handle(request, requestId, started, fail);
    } catch (beforeTheWork) {
      // Constructing a client throws when a secret is missing, and `getUser` can
      // reject on a transient network failure — both outside the inner try, so
      // the promise rejected and the caller got no `Problem`, no reference and no
      // CORS headers. The wrapper promises those for every answer it gives.
      log('error', {
        fn: spec.name,
        request_id: requestId,
        event: 'failed',
        status: 503,
        reason: (beforeTheWork as { code?: string } | undefined)?.code ?? 'unconfigured',
        duration_ms: Date.now() - started,
      });
      return respond(
        503,
        plainProblem('unavailable', 503, 'Something went wrong at our end.', requestId).body,
        requestId,
      );
    }
  };

  async function handle(
    request: Request,
    requestId: string,
    started: number,
    fail: (problem: { status: number; body: unknown }, reason?: string) => Response,
  ): Promise<Response> {
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

    const identified = await identify(caller, token);
    if (identified.outcome === 'unavailable') {
      // The auth server could not be asked. Telling somebody to sign in again, when
      // they are signed in and it would have worked a second later, sends them to
      // fix a problem that is ours.
      return fail(plainProblem('unavailable', 503, 'Something went wrong at our end.', requestId));
    }
    if (identified.outcome === 'rejected') {
      return fail(plainProblem('unauthorised', 401, 'Sign in and try again.', requestId));
    }
    const actor: Actor = identified.actor;

    const body = parsed.data as { idempotency_key?: string };
    const key = body.idempotency_key;
    const context = {
      body: parsed.data,
      actor,
      caller,
      service,
      request,
      requestId,
    };

    try {
      // The claim comes first, so that a retry of something that already worked is
      // answered from the record instead of being put through the guard again.
      if (key !== undefined) {
        const replayed = await claim(
          service,
          spec.name,
          actor.userId,
          key as Parameters<typeof claim>[3],
          parsed.data,
          spec.fingerprintExcludes ?? [],
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

      // The guard, now that we know this is not a replay. A failure here always
      // gives the claim back: Turnstile and the counters write nothing the caller
      // asked for, so there is never anything to protect a retry from.
      if (spec.guard !== undefined) {
        try {
          await spec.guard(context);
        } catch (duringGuard) {
          if (key !== undefined) {
            try {
              await release(service, spec.name, actor.userId, key as Parameters<typeof release>[3]);
            } catch {
              /* the request already failed; this would only hide why */
            }
          }
          throw duringGuard;
        }
      }

      let result: unknown;
      try {
        result = await spec.handle(context);
      } catch (duringWork) {
        // The claim is given back only when we know the work did not happen —
        // `outcomeOf` is where that judgement lives, next to the rest of the
        // reasoning about failures. Releasing must not become the error the caller
        // sees, so its own failure is swallowed: the original is worth reporting.
        const outcome = outcomeOf(duringWork);

        if (key !== undefined && outcome.committed === 'no') {
          try {
            await release(service, spec.name, actor.userId, key as Parameters<typeof release>[3]);
          } catch {
            /* the request already failed; this would only hide why */
          }
        } else if (key !== undefined) {
          log('warn', {
            fn: spec.name,
            request_id: requestId,
            event: 'claim_held',
            reason: outcome.code,
            duration_ms: Date.now() - started,
          });
        }
        throw duringWork;
      }

      // Recording is deliberately *outside* the release above, and deliberately
      // cannot fail the request. By this line the work has committed. Releasing
      // the claim now would let a retry run a mutation that has already
      // happened — and reattachment is not harmless to repeat: the second
      // attempt answers `member_not_found`, because the membership it names has
      // already moved. Failing the request would be worse still, reporting an
      // error for something that worked.
      //
      // So the claim stays, the answer goes out, and the narrow case left is a
      // client that never saw this response *and* a recording that failed, which
      // gets `in_progress` on its retry. That is honest: we cannot replay an
      // answer we did not manage to store.
      if (key !== undefined) {
        try {
          await record(
            service,
            spec.name,
            actor.userId,
            key as Parameters<typeof record>[3],
            200,
            result,
          );
        } catch {
          log('warn', {
            fn: spec.name,
            request_id: requestId,
            event: 'unrecorded',
            status: 200,
            duration_ms: Date.now() - started,
          });
        }
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
      const problem = problemOf(thrown, requestId);
      return fail(problem, problem.code);
    }
  }
}
