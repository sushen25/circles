import { CreateCircleRequest, type CreateCircleResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { Refusal } from '../_shared/problem.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { inviteSecret } from '../_shared/secret.ts';

/**
 * A circle and the link that fills it, in one call (spec §5.1, steps 4 and 5).
 *
 * Two RPCs rather than one, and the idempotency record is what makes that safe.
 * `public.create_circle` is idempotent on the key it is given — asking twice
 * returns the circle the first attempt made, which matters because a person who
 * cannot tell a timeout from a failure would otherwise end up with two circles
 * and no idea which link they shared. If the second call fails, the claim is
 * released (a SQLSTATE says the transaction aborted), and the retry finds the
 * circle already there and issues the invite it was missing.
 *
 * The secret is generated here and only its SHA-256 is given to
 * `issue_invite` — the readable form is never a statement parameter, never in a
 * query log, and not recoverable from `circle_invites` at all.
 *
 * With one deliberate exception, which is worth stating rather than implying:
 * the idempotency record keeps the *response*, and the response is where the
 * secret is. It has to — a retry whose first attempt was lost must return the
 * same link, or the guarantee is hollow for the one endpoint where it matters
 * most. So the readable secret sits in `jobs.idempotent_requests` for the retry
 * window, in a table no client role can read and RLS denies by default, until
 * retention sweeps it after seven days. That is a smaller exposure than a link
 * the person cannot get back.
 */
Deno.serve(
  jsonHandler({
    name: 'create-circle',
    schema: CreateCircleRequest,
    guard: async ({ actor, service, request }) => {
      if (actor.isAnonymous) {
        // The database refuses this too, and that is the enforcement. Saying it
        // here first means the client gets `requires_saved_place` — its cue to
        // show InitiateGate — rather than a generic refusal, and costs nothing:
        // the JWT already says.
        throw new Refusal('requires_saved_place', 'Save your place first, then make a circle.');
      }

      await enforce(service, [
        { scope: 'create_circle', key: actor.userId, max: 10, window: '1 hour' },
        { scope: 'create_circle_ip', key: callerAddress(request), max: 20, window: '1 hour' },
      ]);
    },
    handle: async ({ body, caller }): Promise<CreateCircleResponse> => {
      const { data: circle, error } = await caller.rpc('create_circle', {
        name: body.name,
        color: body.color,
        time_zone: body.time_zone,
        idempotency_key: body.idempotency_key,
        cadence: body.cadence,
      });
      if (error !== null) throw error;

      const secret = inviteSecret();
      const { error: inviteError } = await caller.rpc('issue_invite', {
        p_circle_id: (Array.isArray(circle) ? circle[0] : circle).id,
        p_secret_hash: await sha256Hex(secret),
      });
      if (inviteError !== null) throw inviteError;

      return { circle: circleDto(circle), invite_secret: secret };
    },
  }),
);
