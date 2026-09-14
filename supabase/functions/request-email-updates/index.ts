import { CONSENT } from '@circles/config';
import { RequestEmailUpdatesRequest, type RequestEmailUpdatesResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { mintToken, tokenHash } from '../_shared/tokens.ts';

/**
 * "Email me about this meetup" (spec §5.8).
 *
 * The address reaches `private.email_contacts` and stops there. It is not in
 * the response, not in a log, not in an analytics payload and not in the
 * problem a failure produces — non-negotiable 8, and the one table that holds
 * an address is the one that hashes it for every lookup.
 *
 * **The answer is the same whatever happened.** Verified already, suppressed
 * after a bounce, held by somebody else, or never seen: "check your email". A
 * response that distinguished them would let anybody walk a list of addresses
 * through a plan they belong to and learn which of their friends use the
 * product — and a suppressed address in particular has asked not to hear from
 * us, which has to outrank telling a third party about it (spec §9).
 *
 * The consent recorded is `CONSENT.version` from `packages/config`: a consent
 * record that cannot say what was agreed is not one.
 */
Deno.serve(
  jsonHandler({
    name: 'request-email-updates',
    schema: RequestEmailUpdatesRequest,
    guard: async ({ actor, body, service, request }) => {
      // Three a day per address, because a resend is legitimate and a hundred
      // is somebody using us to send mail to a stranger; five a day per caller,
      // because an anonymous identity is cheap and a member is not. Neither is
      // authorisation: the membership check in the database is.
      await enforce(service, [
        { scope: 'email_request_address', key: body.email, max: 3, window: '1 day' },
        { scope: 'email_request_user', key: actor.userId, max: 5, window: '1 day' },
        { scope: 'email_request_ip', key: callerAddress(request), max: 20, window: '1 day' },
      ]);
    },
    handle: async ({ body, actor, service }): Promise<RequestEmailUpdatesResponse> => {
      // Minted here and hashed on the way in: the readable token exists in this
      // request and in the email, and is never a statement parameter (§14).
      const token = mintToken();

      const { error } = await service.rpc('request_email_updates', {
        p_plan_id: body.plan_id,
        p_user_id: actor.userId,
        p_email: body.email,
        p_token_hash: await tokenHash(token),
        p_consent_version: CONSENT.version,
      });
      if (error !== null) throw error;

      // The token goes no further. S1-19's template reads it from the job the
      // database just wrote — this response carries nothing an attacker could
      // use, and nothing that says whether anything was sent.
      return { status: 'check_email' };
    },
  }),
);
