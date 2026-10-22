import { z } from 'zod';

import { internalHandler } from '../_shared/internal.ts';
import { enforce } from '../_shared/rate.ts';

/**
 * The content loop's read of the funnel by campaign tag (ADR 0087).
 *
 * A GitHub Action posts `{ since }` under `CONTENT_FUNNEL_SECRET` and gets back
 * `public.content_funnel_export`: the circles made, plans shared, answered and
 * confirmed for each `?from=` tag, and the first plans that came from content
 * and stopped. Counts and ages, and nothing finer; the function that computes
 * it returns no id, code, name or address, and this one adds none.
 *
 * **Its own secret.** `internalHandler` is told to check `CONTENT_FUNNEL_SECRET`
 * rather than `CRON_SECRET`, so the cron secret cannot read the funnel and this
 * one cannot run the job processor. Unset, every call is refused.
 *
 * **Twelve calls an hour**, counted against one key because there is no caller
 * to key on. The nightly run makes one; the rest is room for a retry and for a
 * person running it by hand. It is a brake on a leaked secret, not
 * authorisation.
 *
 * Nothing is logged but the handler's own status line: no tag, no count.
 */
const LIMIT = { scope: 'content_funnel', key: 'content-funnel', max: 12, window: '1 hour' };

Deno.serve(
  internalHandler({
    name: 'content-funnel',
    secretName: 'CONTENT_FUNNEL_SECRET',
    schema: z.object({ since: z.string().date() }).strict(),
    handle: async ({ body, service }): Promise<unknown> => {
      await enforce(service, [LIMIT]);
      const { data, error } = await service.rpc('content_funnel_export', { p_since: body.since });
      if (error !== null) throw error;
      return data;
    },
  }),
);
