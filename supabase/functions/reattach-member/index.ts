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
    handle: async ({ body, actor, caller, service, request }): Promise<ReattachMemberResponse> => {
      await enforce(service, [
        { scope: 'reattach_ip', key: callerAddress(request), max: 10, window: '1 hour' },
      ]);

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
