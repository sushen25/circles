import { RedeemInviteRequest, type RedeemInviteResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';

/**
 * Joining a circle from its link — the first thing anybody does (spec §5.1).
 *
 * Thin on purpose. The secret is hashed here so that it never becomes a
 * statement parameter, Turnstile and the per-link limits are applied here
 * because they are about *volume*, and then `public.redeem_invite` decides
 * everything that matters: whether the invite is live, whether there is room,
 * whether the name is taken, and whose membership this becomes. Calling it with
 * the caller's own JWT is what makes that last one true — the membership lands
 * on `auth.uid()`, which no request body can influence.
 */
Deno.serve(
  jsonHandler({
    name: 'redeem-invite',
    schema: RedeemInviteRequest,
    guard: async ({ body, service, request }) => {
      await verifyTurnstile(request, body.turnstile_token);

      await enforce(service, [
        // Per link rather than per circle: the circle is not known until the
        // invite has been found, and an invite belongs to exactly one circle, so
        // the two limits are the same limit (§14).
        { scope: 'redeem_invite', key: await sha256Hex(body.secret), max: 20, window: '1 hour' },
        { scope: 'redeem_ip', key: callerAddress(request), max: 10, window: '1 hour' },
      ]);
    },
    handle: async ({ body, actor, caller }): Promise<RedeemInviteResponse> => {
      const { data, error } = await caller.rpc('redeem_invite', {
        p_secret_hash: await sha256Hex(body.secret),
        p_display_name: body.display_name,
      });
      if (error !== null) throw error;

      return { circle: circleDto(data), member_user_id: actor.userId };
    },
  }),
);
