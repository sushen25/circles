import { VerifyEmailContactRequest, VerifyEmailContactResponse } from '@circles/contracts';

import { linkHandler } from '../_shared/link.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { tokenHash } from '../_shared/tokens.ts';

/**
 * The link in the verification email (spec §5.8).
 *
 * No session and no actor: the token is the authorisation, which is why this is
 * a `linkHandler`. Somebody verifying may have cleared their storage, be on a
 * different device, or have no account at all — requiring a sign-in to confirm
 * an address would ask them to do the thing the address exists to avoid.
 *
 * Consumed in one statement in the database, so two clicks arriving together
 * cannot both succeed; spent, expired and never-ours are one answer, because
 * telling them apart would say whether a token existed.
 */
Deno.serve(
  linkHandler({
    name: 'verify-email-contact',
    schema: VerifyEmailContactRequest,
    handle: async ({ body, service, request }): Promise<VerifyEmailContactResponse> => {
      // Per address, because there is nobody else to count: an unauthenticated
      // endpoint has only the connection. The token is 256 bits, so this is
      // about load rather than guessing.
      await enforce(service, [
        { scope: 'verify_email_ip', key: callerAddress(request), max: 60, window: '1 hour' },
      ]);

      const { data, error } = await service.rpc('verify_email_contact', {
        p_token_hash: await tokenHash(body.token),
      });
      if (error !== null) throw error;

      const result = data as unknown as {
        active_plan_ids: string[];
        already_confirmed: boolean;
      };

      return VerifyEmailContactResponse.parse({
        active_plan_ids: result.active_plan_ids,
        already_confirmed: result.already_confirmed,
      });
    },
  }),
);
