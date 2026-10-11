import { StopNudgesRequest, StopNudgesResponse } from '@circles/contracts';

import { linkHandler } from '../_shared/link.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { tokenHash } from '../_shared/tokens.ts';

/**
 * "Stop these reminders", from the link under a cadence nudge (ADR 0067).
 *
 * No sign-in: the token is the whole of the authorisation, and it is scoped to
 * one person and one kind of letter (`nudge_stop`). It turns off the "Nudges to
 * plan the next one" switch for that person and nothing else. It is not
 * consumed, so a second tap is harmless; and nothing about the person or their
 * circles is in the answer. The token is never logged or put in an event.
 */
Deno.serve(
  linkHandler({
    name: 'stop-nudges',
    schema: StopNudgesRequest,
    handle: async ({ body, service, request }): Promise<StopNudgesResponse> => {
      await enforce(service, [
        { scope: 'stop_nudges_ip', key: callerAddress(request), max: 60, window: '1 hour' },
      ]);

      const { data, error } = await service.rpc('stop_nudges', {
        p_token_hash: await tokenHash(body.token),
      });
      if (error !== null) throw error;

      return StopNudgesResponse.parse(data);
    },
  }),
);
