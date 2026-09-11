import { ClaimIdentityRequest, type ClaimIdentityResponse } from '@circles/contracts';

import { actorFrom } from '../_shared/auth.ts';
import { jsonHandler } from '../_shared/http.ts';
import { Refusal } from '../_shared/problem.ts';

/**
 * Saving your place, when the account turned out to exist already (§10).
 *
 * This is the one function in the kit that has to do its own authorisation, and
 * the reason is worth stating plainly. The claim being made is "the anonymous
 * session that was here a moment ago was also me". After `signInWithIdToken` the
 * caller's JWT belongs to the *permanent* identity, so `auth.uid()` cannot answer
 * for the anonymous one — and a user id in a request body is evidence of nothing.
 *
 * So the client sends the old session's **access token**, and this verifies it
 * with the auth server before naming that identity to the database. Which is also
 * why `public.claim_identity` is granted to `service_role` and nothing else: it
 * takes the identity it acts on as an argument, and an argument like that must
 * not be reachable by a client.
 */
Deno.serve(
  jsonHandler({
    name: 'claim-identity',
    schema: ClaimIdentityRequest,
    handle: async ({ body, actor, caller, service }): Promise<ClaimIdentityResponse> => {
      const previous = await actorFrom(caller, body.anonymous_session);

      if (previous === undefined) {
        // An expired or forged token proves nothing.
        throw new Refusal('source_is_permanent', 'That session could not be confirmed.');
      }

      if (!previous.isAnonymous) {
        // Checked here as well as in SQL, because here it can be said precisely:
        // the token verified, and the identity behind it has a saved place of its
        // own. Merging two accounts on one caller's word is how an account is
        // taken.
        throw new Refusal('source_is_permanent', 'That session belongs to a different account.');
      }

      // When the two are the same identity — `linkIdentity` on the session that
      // is still signed in — there is nothing to merge, and the call still goes
      // through: the database marks the profile and writes `account_claimed`
      // once. Returning early here would be a second opinion about idempotence.
      const { data, error } = await service.rpc('claim_identity', {
        p_user_id: actor.userId,
        p_anonymous_user_id: previous.userId,
        p_moment: body.moment,
      });
      if (error !== null) throw error;

      return { user_id: actor.userId, merged_memberships: typeof data === 'number' ? data : 0 };
    },
  }),
);
