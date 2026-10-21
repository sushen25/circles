import { DeleteAccountRequest, type DeleteAccountResponse } from '@circles/contracts';

import { bearerOf } from '../_shared/auth.ts';
import { recalculateAfterWriting } from '../_shared/engine.ts';
import { jsonHandler } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';

/**
 * A saved-place identity deletes itself (spec §13; S4-05, ADR 0083).
 *
 * `public.delete_account` is the whole of the decision and nearly all of the
 * work, as the caller and in one transaction: the circles they own are handed
 * on or archived, their memberships end as a removal, their answers and
 * windows go, email is withdrawn, push is disabled, **their sessions are
 * deleted and the user is banned** — so that "a deleted user cannot sign in" is
 * a fact about the committed row and not about this function finishing.
 *
 * What is left is what the database cannot do. The session in this request's
 * JWT is also revoked through the auth API (`signOut` with `global`), so a
 * refresh token cannot outlive the deletion on any device; a failure there is
 * logged and does not fail the request, because the ban and the deleted
 * sessions already stand. Then each plan that lost the person's answers is
 * recalculated, as in `remove-member` (ADR 0018), and a failure to do that
 * cannot fail the request either: the stale set is refused by `confirm` until
 * `recalculate-candidates` catches up.
 *
 * Nothing about the person is logged: not the id, not the circles, not the
 * counts beyond the two numbers the response carries.
 */
Deno.serve(
  jsonHandler({
    name: 'delete-account',
    schema: DeleteAccountRequest,
    handle: async ({ request, caller, service, requestId }): Promise<DeleteAccountResponse> => {
      const { data, error } = await caller.rpc('delete_account');
      if (error !== null) throw error;

      const done = data as { stale_plans: string[]; transferred: number; archived: number };

      const token = bearerOf(request.headers.get('authorization'));
      if (token !== undefined) {
        try {
          const { error: signOutError } = await service.auth.admin.signOut(token, 'global');
          if (signOutError !== null) throw signOutError;
        } catch {
          log('warn', { fn: 'delete-account', request_id: requestId, event: 'sign_out_failed' });
        }
      }

      for (const planId of done.stale_plans) {
        await recalculateAfterWriting(service, planId, requestId);
      }

      return { ok: true, circles_handed_on: done.transferred, circles_archived: done.archived };
    },
  }),
);
