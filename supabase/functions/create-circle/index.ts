import { CreateCircleRequest, type CreateCircleResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { optional } from '../_shared/env.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { Refusal } from '../_shared/problem.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { newInvite } from '../_shared/secret.ts';

/**
 * A circle and the link that fills it, in one call (spec §5.1, steps 4 and 5).
 *
 * One RPC, because two were one transaction too many: `create_circle` and then
 * `issue_invite` meant a failure between them left a circle with no way into
 * it, an event announcing it, and a person reading an error. The retry could
 * repair that only if the client sent the same idempotency key — and a person
 * who has just been told it failed tends to start again, which is a second
 * circle. The digest goes in with the circle now, and the answer to "did that
 * work?" is one answer.
 *
 * `create_circle` is idempotent on the key it is given: asking twice returns the
 * circle the first attempt made, which matters because a person who cannot tell
 * a timeout from a failure would otherwise end up with two circles and no idea
 * which link they shared.
 *
 * The secret is generated here and only its SHA-256 is stored — the readable
 * form is never a statement parameter, never in a query log, and not
 * recoverable from `circle_invites` at all. It is *derived* from the invite's
 * id under `INVITE_LINK_KEY` when that is set (ADR 00XX), which is what lets
 * `get-invite-link` show the owner this link again after a reload; the key is
 * an Edge Function secret, so the database alone still cannot.
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
      const { inviteId, secret } = await newInvite(optional('INVITE_LINK_KEY'));
      const { data: circle, error } = await caller.rpc('create_circle', {
        name: body.name,
        color: body.color,
        time_zone: body.time_zone,
        idempotency_key: body.idempotency_key,
        cadence: body.cadence,
        invite_secret_hash: await sha256Hex(secret),
        ...(inviteId === undefined ? {} : { invite_id: inviteId }),
      });
      if (error !== null) throw error;

      return { circle: circleDto(circle), invite_secret: secret };
    },
  }),
);
