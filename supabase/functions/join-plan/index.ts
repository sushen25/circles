import { JoinPlanRequest, type JoinPlanResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { recalculateAfterWriting } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';
import { enforce, isActiveMember, joinLimits } from '../_shared/rate.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';

/**
 * Joining a circle from a plan's link (ADR 0022).
 *
 * The link a group chat actually sees is the plan's, and until ADR 0022 it let
 * nobody in. Now a plan's short code admits new members while the plan is
 * taking answers, and makes them somebody that plan is asking.
 *
 * A function of its own rather than a second shape on `redeem-invite`: what
 * authorises it is different, its limits count different things, and its body
 * must never be one that could carry a secret.
 *
 * Thin, like `redeem-invite`, with one difference that matters.
 * `public.join_from_plan` decides whether the plan is admitting, whether there
 * is room and whether the name is taken — but it is the **service role's**, and
 * this passes the verified caller's id to it. `redeem-invite` can call its
 * function with the caller's own JWT because an invite secret is 256 bits; a
 * plan code is eight characters, and a function any session could reach over
 * PostgREST would skip the Turnstile check and both limits below, which are the
 * whole of what makes a guessable code acceptable (ADR 0022). So this is the
 * only way in, and the id is `actor.userId` — resolved from the JWT, never read
 * from the body.
 *
 * **What it costs to call (SUS-113).** Limits are spent by whoever makes the
 * attempts and by nobody else, so one person cannot use up a link's allowance
 * for everybody who holds it:
 *
 * - an active member of the plan's circle calling again costs nothing;
 * - anybody else is counted per code and caller (10 an hour), per caller
 *   across codes (30 an hour: the brake on guessing) and per address (120 an
 *   hour, sized for a household or a carrier, as the sign-in limit is);
 * - there is no counter every holder of the code shares. Admission is bounded
 *   by the member cap (ADR 0012), so twenty people can join in one hour from
 *   one address.
 *
 * `joinLimits` in `_shared/rate.ts` holds the numbers and the reasoning, and
 * is shared with `redeem-invite`.
 *
 * **Neither the code nor the name is logged.** The code sits in URL paths, but
 * it admits people now (ADR 0022), so it stays out of everything we write
 * ourselves. The limits hash their keys; the wrapper's log line carries the
 * function's name, the status and a reason, and nothing from the body.
 */
Deno.serve(
  jsonHandler({
    name: 'join-plan',
    schema: JoinPlanRequest,
    // A Turnstile token is single-use and fetched fresh on every attempt, so it
    // cannot be part of what identifies the request (as `redeem-invite`).
    fingerprintExcludes: ['turnstile_token'],
    guard: async ({ body, actor, service, request }) => {
      await verifyTurnstile(request, body.turnstile_token);

      // Somebody already in the circle costs nothing (see `joinLimits`). Whether
      // they are is read from the code's circle, with the service client for the
      // one column; a code that finds nothing is a stranger's guess and is charged.
      const { data: plan } = await service
        .from('plans')
        .select('circle_id')
        .eq('short_code', body.plan_code)
        .maybeSingle();
      const circleId = (plan as { circle_id?: string } | null)?.circle_id ?? null;
      if (await isActiveMember(service, circleId, actor.userId)) return;

      await enforce(
        service,
        joinLimits({
          scopes: { link: 'join_plan', caller: 'join_plan_caller', address: 'join_plan_ip' },
          link: body.plan_code,
          userId: actor.userId,
          request,
        }),
      );
    },
    handle: async ({ body, actor, service, requestId }): Promise<JoinPlanResponse> => {
      const { data, error } = await service.rpc('join_from_plan', {
        p_user_id: actor.userId,
        p_short_code: body.plan_code,
        ...(body.display_name === undefined ? {} : { p_display_name: body.display_name }),
      });
      if (error !== null) throw error;

      const joined = data as { circle: unknown; plan_id: string; newly_asked: boolean };

      // The plan is asking one more person, and its candidate set says how many
      // it is asking — so it is recalculated here, in the request that changed
      // it (ADR 0018), as an answer is. Not when nothing changed: replacing the
      // set an organiser is looking at because somebody opened a link twice
      // would make their confirm stale for no reason.
      //
      // It cannot fail this request. The join is committed, and reporting an
      // error for it would leave the retry refused as a replay.
      if (joined.newly_asked) {
        await recalculateAfterWriting(service, joined.plan_id, requestId);
      }

      return {
        circle: circleDto(joined.circle),
        member_user_id: actor.userId,
        plan_code: body.plan_code,
      };
    },
  }),
);
