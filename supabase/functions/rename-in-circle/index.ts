import { RenameInCircleRequest, type RenameInCircleResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { enforce } from '../_shared/rate.ts';

/**
 * A member changes the name one circle calls them (SUS-205, ADR 0070).
 *
 * `public.rename_in_circle` does the whole of it, as the caller: their own
 * active membership in this circle, the join path's name rules, nothing else.
 * What is left is the part the database cannot do, a volume limit.
 *
 * The limit is per person, not per circle or address: a name is changed a few
 * times in a membership's life, so twenty an hour is generous for a person and
 * stops a loop. Nothing is logged or sent to analytics beyond the request id
 * and function name: not the name, and not the circle.
 */
Deno.serve(
  jsonHandler({
    name: 'rename-in-circle',
    schema: RenameInCircleRequest,
    guard: async ({ actor, service }) => {
      await enforce(service, [
        { scope: 'rename_in_circle', key: actor.userId, max: 20, window: '1 hour' },
      ]);
    },
    handle: async ({ body, caller }): Promise<RenameInCircleResponse> => {
      const { error } = await caller.rpc('rename_in_circle', {
        p_circle_id: body.circle_id,
        p_display_name: body.display_name,
      });
      if (error !== null) throw error;
      return { ok: true };
    },
  }),
);
