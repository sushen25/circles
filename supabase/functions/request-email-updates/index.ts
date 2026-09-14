import { CONSENT } from '@circles/config';
import { RequestEmailUpdatesRequest, type RequestEmailUpdatesResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';

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
      // Three a day for *this person and this address*, not for the address
      // alone. A counter keyed on the address is shared by everybody who can
      // name it, and `take_rate_token` counts refusals too — so three requests
      // naming somebody else's address would lock the real owner out for the
      // day, and a 429 on a first attempt would tell the sender that somebody
      // else had asked about it. The pair is what a resend is.
      //
      // Five a day per caller and twenty per connection stand behind it, for
      // the volume the pair cannot see: an anonymous identity is cheap.
      // None of this is authorisation — the membership check in the database is.
      await enforce(service, [
        { scope: 'email_request', key: `${actor.userId}:${body.email}`, max: 3, window: '1 day' },
        { scope: 'email_request_user', key: actor.userId, max: 5, window: '1 day' },
        { scope: 'email_request_ip', key: callerAddress(request), max: 20, window: '1 day' },
      ]);
    },
    handle: async ({ body, actor, service, requestId }): Promise<RequestEmailUpdatesResponse> => {
      // No token is minted here. The one in the email is minted by whoever
      // sends the email (ADR 0020) — `issueVerificationToken`, from the job
      // this call writes — because a token made in this request has no way of
      // reaching the letter: the job row carries ids and no payload. Making one
      // here and dropping it is what an earlier draft did, and it left every
      // verification link unsendable.
      //
      // `requestId` is the occurrence in the job's idempotency key: a retry is
      // answered by the claim above and never arrives, and a genuine resend is
      // a different request and so a different email.
      const { error } = await service.rpc('request_email_updates', {
        p_plan_id: body.plan_id,
        p_user_id: actor.userId,
        p_email: body.email,
        p_consent_version: CONSENT.version,
        p_request_id: requestId,
      });
      if (error !== null) throw error;

      // Nothing about the address, and nothing about what happened to it.
      return { status: 'check_email' };
    },
  }),
);
