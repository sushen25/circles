import { JoinPlanRequest, type JoinPlanResponse } from '@circles/contracts';

import { circleDto } from '../_shared/circle.ts';
import { recalculateAfterWriting } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
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
 * Thin, like `redeem-invite`. Turnstile and the limits are here because they
 * are about volume; `public.join_from_plan` decides everything that matters —
 * whether the plan is admitting, whether there is room, whether the name is
 * taken, and whose membership this becomes, which is `auth.uid()` because it
 * is called with the caller's own JWT.
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
    guard: async ({ body, service, request }) => {
      await verifyTurnstile(request, body.turnstile_token);

      await enforce(service, [
        // Per code rather than per circle, for the reason `redeem-invite` counts
        // per link: the circle is not known until the plan has been found. A code
        // is eight characters, not 256 bits, so this is also what makes walking
        // the code space slow.
        { scope: 'join_plan', key: body.plan_code, max: 20, window: '1 hour' },
        { scope: 'join_plan_ip', key: callerAddress(request), max: 10, window: '1 hour' },
      ]);
    },
    handle: async ({ body, actor, caller, service, requestId }): Promise<JoinPlanResponse> => {
      const { data, error } = await caller.rpc('join_from_plan', {
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
