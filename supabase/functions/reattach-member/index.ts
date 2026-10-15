import { ReattachMemberRequest, type ReattachMemberResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';

/**
 * Coming back with no session — "Continue as", and the emailed way in (ADR 0006,
 * §10).
 *
 * Every safeguard is in `public.reattach_member`: the caller must be a guest, the
 * target must be a guest, three moves per membership per seven days. None of them
 * is repeated here, deliberately — a guard in an Edge Function is a guard the
 * next Edge Function has to remember to write again.
 *
 * What this adds is a per-address limit, because the rule ADR 0006 names is per
 * *membership* and a script does not have to use one membership, and a per-token
 * one. The per-circle limit is the database's (ADR 0049).
 */
Deno.serve(
  jsonHandler({
    name: 'reattach-member',
    schema: ReattachMemberRequest,
    guard: async ({ body, service, request }) => {
      // No per-circle counter here, on purpose. The circle id is a value the
      // caller chooses and is not a secret (it is in every email footer link), so
      // a bucket keyed on it lets somebody who is not a member use up the
      // allowance for the circle's real members. The per-circle limit is
      // `public.reattach_member`'s (ADR 0049): it counts completed moves only,
      // after the caller has been checked, and applies to a direct RPC call too.
      //
      // The token path cannot be keyed by circle either: the circle is inside the
      // token, and only the database can read it. It is keyed by the token's own
      // digest, which is stricter - a single-use link tried four times is
      // somebody guessing.
      await enforce(service, [
        { scope: 'reattach_ip', key: callerAddress(request), max: 10, window: '1 hour' },
        ...(body.reentry_token !== undefined
          ? [
              {
                scope: 'reattach_token',
                key: await sha256Hex(body.reentry_token),
                max: 3,
                window: '1 hour',
              },
            ]
          : []),
      ]);
    },
    handle: async ({ body, actor, caller }): Promise<ReattachMemberResponse> => {
      const { data, error } = await caller.rpc('reattach_member', {
        p_circle_id: body.circle_id ?? null,
        p_target_user_id: body.target_member_user_id ?? null,
        // Hashed here, as the database stores it: a token is never a parameter in
        // its readable form (§14).
        p_reentry_token_hash:
          body.reentry_token === undefined ? null : await sha256Hex(body.reentry_token),
      });
      if (error !== null) throw error;

      return { circle: circleDto(data), member_user_id: actor.userId };
    },
  }),
);
