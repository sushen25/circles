import { GetInviteLinkRequest, type GetInviteLinkResponse } from '@circles/contracts';

import { optional } from '../_shared/env.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { derivedInviteSecret } from '../_shared/secret.ts';

/**
 * The owner's invite link, again (S1-23, ADR 0028).
 *
 * The database has only the live invite's digest; the secret is *derived* from
 * the invite's id under `INVITE_LINK_KEY`. So this asks the database which
 * invite is live — `live_invite`, which is the owner's alone and refuses anybody
 * else with `not_the_owner` — derives the secret for it, and hands it back only
 * if its digest is the one stored. A link made before links were derived, or
 * under a different key, fails that check and comes back as `null`: the screen
 * then offers a reset, which is the only honest way to a link nobody can show.
 *
 * A read: no idempotency key, so no idempotency record holds the answer. The
 * secret is in the response body and nowhere else — not in the log line, which
 * the kit builds from fixed fields, and not in an error.
 */
Deno.serve(
  jsonHandler({
    name: 'get-invite-link',
    schema: GetInviteLinkRequest,
    handle: async ({ body, caller, requestId }): Promise<GetInviteLinkResponse> => {
      const { data, error } = await caller.rpc('live_invite', { p_circle_id: body.circle_id });
      if (error !== null) throw error;

      const live = (data ?? [])[0];
      if (live === undefined) return { invite_secret: null };

      const key = optional('INVITE_LINK_KEY');
      if (key === undefined) {
        // A deployment without the key cannot show a link again. Said once per
        // request, with no id: the health of the configuration, not the circle.
        log('warn', { fn: 'get-invite-link', request_id: requestId, event: 'invite_key_unset' });
        return { invite_secret: null };
      }

      const secret = await derivedInviteSecret(key, live.invite_id);
      return { invite_secret: (await sha256Hex(secret)) === live.secret_hash ? secret : null };
    },
  }),
);
