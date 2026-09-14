import { ManageEmailPreferencesRequest, ManageEmailPreferencesResponse } from '@circles/contracts';

import { linkHandler } from '../_shared/link.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';
import { tokenHash } from '../_shared/tokens.ts';

/**
 * "Stop emails for this meetup", and "manage email preferences" (spec §5.8).
 *
 * Both links are in every event email and both have to work with no sign-in —
 * the Spam Act's unsubscribe answered in one tap, for somebody who may have no
 * account and no memory of the circle. The token is long-lived and **not**
 * consumed: an unsubscribe link that worked once and then expired would be an
 * unsubscribe link that does not work.
 *
 * `remove_contact` suppresses the address by its hash, in a table nothing
 * deletes from, so the promise survives the contact row being purged — and so
 * that somebody adding the address again later cannot restart the email on
 * their behalf (spec §9).
 */
Deno.serve(
  linkHandler({
    name: 'manage-email-preferences',
    schema: ManageEmailPreferencesRequest,
    handle: async ({ body, service, request }): Promise<ManageEmailPreferencesResponse> => {
      await enforce(service, [
        { scope: 'email_prefs_ip', key: callerAddress(request), max: 60, window: '1 hour' },
      ]);

      const { data, error } = await service.rpc('email_preferences', {
        p_token_hash: await tokenHash(body.token),
        p_action: body.action,
        p_plan_id: body.plan_id ?? null,
      });
      if (error !== null) throw error;

      return ManageEmailPreferencesResponse.parse(data);
    },
  }),
);
