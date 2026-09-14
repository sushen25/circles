import { CreatePlanRequest, type CreatePlanResponse, DateWindow } from '@circles/contracts';
import {
  defaultDeadline,
  isDeadlineAllowed,
  lastPossibleStart,
  quorumDefault,
  resolvePreset,
} from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { fromInstant, now, toInstant, toLocalDate, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import { enforce } from '../_shared/rate.ts';

/**
 * "One card summarising the defaults … **Ask the group**" (spec §5.1, step 7).
 *
 * The client sends what the person chose — a preset, a title — and this turns it
 * into a plan using `packages/domain` and nothing else. Every number in the
 * result comes from a rule that exists once: `resolvePreset` for the window,
 * `defaultDeadline` for when replies close, `quorumDefault` for how many people
 * make it worth having. A screen that computed any of them would be the second
 * copy (non-negotiable 2).
 *
 * What the database decides is who may create one and whether anybody is told:
 * `public.create_plan` inserts a draft and hands it to the state machine, whose
 * `draft → create_named` guards are an active member with a saved place
 * (ADR 0004) and whose transition is what emits `planning.plan_created`.
 */
Deno.serve(
  jsonHandler({
    name: 'create-plan',
    schema: CreatePlanRequest,
    guard: async ({ body, actor, service }) => {
      if (body.mode === 'quiet') {
        // Not a refusal of this person: the quiet ask is S2-02. Saying so with
        // its own reason keeps the client from showing a failure for a feature
        // that simply has not landed.
        throw new Refusal('not_yet', 'Quiet asks are not ready yet.');
      }

      await enforce(service, [
        { scope: 'create_plan', key: actor.userId, max: 30, window: '1 hour' },
        { scope: 'create_plan_circle', key: body.circle_id, max: 30, window: '1 hour' },
      ]);
    },
    handle: async ({ body, caller }): Promise<CreatePlanResponse> => {
      // Read through the caller's own client, so RLS answers the question "may
      // this person see this circle?" rather than the function assuming it.
      const { data: circle, error: circleError } = await caller
        .from('circles')
        .select('time_zone, status, default_duration_minutes, default_quorum')
        .eq('id', body.circle_id)
        .maybeSingle();
      if (circleError !== null) throw circleError;
      if (circle === null) throw new Refusal('circle_not_found', 'That circle is not there.');
      if (circle.status !== 'active') {
        throw new Refusal('circle_archived', 'That circle is archived.');
      }

      const { count, error: countError } = await caller
        .from('circle_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('circle_id', body.circle_id)
        .eq('status', 'active');
      if (countError !== null) throw countError;

      const zone = toZone(circle.time_zone);
      const at = now();
      const durationMinutes = body.duration_minutes ?? circle.default_duration_minutes;

      const resolved = resolvePreset(body.preset, at, zone, {
        durationMinutes,
        custom:
          body.custom === undefined
            ? undefined
            : { start: toLocalDate(body.custom.start), end: toLocalDate(body.custom.end) },
        daily: body.daily,
      });

      // The domain's own error names, passed through unchanged: each one is a
      // screen, and renaming them here would hide which rule produced it.
      if (typeof resolved === 'string') {
        throw new Refusal(resolved, 'That window does not work.');
      }

      const latestStart = lastPossibleStart({
        window: resolved.window,
        daily: resolved.daily,
        durationMinutes,
        zone,
      });

      const deadline = body.response_deadline ?? deadlineFor();
      function deadlineFor(): string {
        const suggested = defaultDeadline(body.preset, at, latestStart);
        if (suggested === undefined) {
          // No instant satisfies both "after now" and "not after the last
          // possible start" — the window has effectively gone.
          throw new Refusal('window_has_passed', 'There is no time left to ask about.');
        }
        return fromInstant(suggested);
      }

      if (!isDeadlineAllowed(toInstant(deadline), latestStart, at)) {
        throw new Refusal(
          'deadline_out_of_range',
          'Replies have to close before the last possible start.',
        );
      }

      const { data, error } = await caller.rpc('create_plan', {
        p_circle_id: body.circle_id,
        p_title: body.title,
        p_category: body.category,
        p_window_start: resolved.window.start,
        p_window_end: resolved.window.end,
        p_daily_start_local: resolved.daily.startMin,
        p_daily_end_local: resolved.daily.endMin,
        p_duration_minutes: durationMinutes,
        p_quorum: body.quorum ?? circle.default_quorum ?? quorumDefault(count ?? 0),
        p_response_deadline: deadline,
        p_required_member_ids: body.required_member_ids ?? null,
      });
      if (error !== null) throw error;

      const plan = (Array.isArray(data) ? data[0] : data) as {
        id: string;
        short_code: string;
        quorum: number;
      };

      return {
        plan_id: plan.id as CreatePlanResponse['plan_id'],
        short_code: plan.short_code as CreatePlanResponse['short_code'],
        // Parsed, not cast. The domain brands a `LocalDate` one way and the
        // contract another, and a cast between them would be a claim rather than
        // a check — the same reason `circleDto` parses instead of asserting.
        window: DateWindow.parse({ start: resolved.window.start, end: resolved.window.end }),
        daily: { startMin: resolved.daily.startMin, endMin: resolved.daily.endMin },
        duration_minutes: durationMinutes,
        quorum: plan.quorum,
        response_deadline: deadline as CreatePlanResponse['response_deadline'],
      };
    },
  }),
);
