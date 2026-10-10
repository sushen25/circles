import { RedeemInviteRequest, type RedeemInviteResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { enforce, isActiveMember, joinLimits } from '../_shared/rate.ts';
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
 *
 * **What it costs to call (SUS-113).** Limits are spent by whoever makes the
 * attempts and by nobody else, so one person cannot use up a link's allowance
 * for everybody who holds it. An active member of the link's circle calling
 * again costs nothing. Anybody else is counted per link and caller (10 an
 * hour), per caller across links (30 an hour: the brake on guessing) and per
 * address (120 an hour, sized for a household or a carrier). No counter is
 * shared by every holder of the link; admission is bounded by the member cap
 * (ADR 0012). `joinLimits` in `_shared/rate.ts` has the numbers and why.
 */
Deno.serve(
  jsonHandler({
    name: 'redeem-invite',
    schema: RedeemInviteRequest,
    // A Turnstile token is single-use and fetched fresh on every attempt, so it
    // cannot be part of what identifies the request: fingerprinting it made an
    // honest retry with a new token an `idempotency_mismatch`.
    fingerprintExcludes: ['turnstile_token'],
    guard: async ({ body, actor, service, request }) => {
      await verifyTurnstile(request, body.turnstile_token);

      const digest = await sha256Hex(body.secret);

      // Somebody already in the circle costs nothing (see `joinLimits`).
      const { data: invite } = await service
        .from('circle_invites')
        .select('circle_id')
        .eq('secret_hash', digest)
        .maybeSingle();
      const circleId = (invite as { circle_id?: string } | null)?.circle_id ?? null;
      if (await isActiveMember(service, circleId, actor.userId)) return;

      await enforce(
        service,
        joinLimits({
          scopes: { link: 'redeem_invite', caller: 'redeem_caller', address: 'redeem_ip' },
          link: digest,
          userId: actor.userId,
          request,
        }),
      );
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
