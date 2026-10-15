import { StopLettersRequest, StopLettersResponse } from '@circles/contracts';

import { linkHandler } from '../_shared/link.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { tokenHash } from '../_shared/tokens.ts';

/**
 * "Stop these emails", from the link under an account-holder letter (ADR 0067,
 * ADR 0069): the cadence nudge, the organiser's letters about a plan they run,
 * or the quiet ask's two letters to its initiator.
 *
 * No sign-in: the token is the whole of the authorisation, and it is scoped to
 * one person and one family of letters (`nudge_stop`, `organiser_stop` or
 * `quiet_stop`). The request names the family the page was about, and a token
 * of any other purpose is refused. It writes the flag the settings screen
 * writes for that family and nothing else. It is not consumed, so a second tap
 * is harmless; and nothing about the person or their circles is in the answer.
 * The token is never logged or put in an event.
 */
Deno.serve(
  linkHandler({
    name: 'stop-letters',
    schema: StopLettersRequest,
    handle: async ({ body, service, request }): Promise<StopLettersResponse> => {
      await enforce(service, [
        { scope: 'stop_letters_ip', key: callerAddress(request), max: 60, window: '1 hour' },
      ]);

      const { data, error } = await service.rpc('stop_letters', {
        p_token_hash: await tokenHash(body.token),
        p_family: body.family,
      });
      if (error !== null) throw error;

      return StopLettersResponse.parse(data);
    },
  }),
);
