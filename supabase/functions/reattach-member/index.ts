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
 * *membership* and a script does not have to use one membership.
 */
Deno.serve(
  jsonHandler({
    name: 'reattach-member',
    schema: ReattachMemberRequest,
    guard: async ({ body, service, request }) => {
      // Per circle as well as per address, because §9.1 says this endpoint is
      // "rate-limited per circle" and the rule ADR 0006 names is per *membership*
      // — which a script does not have to reuse. Requests spread across addresses
      // and memberships had no counter scoped to the circle at all.
      //
      // The token path cannot be keyed by circle: the circle is inside the token,
      // and only the database can read it. So it is keyed by the token's own
      // digest, which is stricter — a single-use link tried four times is
      // somebody guessing.
      await enforce(service, [
        { scope: 'reattach_ip', key: callerAddress(request), max: 10, window: '1 hour' },
        ...(body.circle_id !== undefined
          ? [{ scope: 'reattach_circle', key: body.circle_id, max: 20, window: '1 hour' }]
          : []),
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
