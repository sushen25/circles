import {
  InvitePreview,
  InvitePreviewRequest,
  type InvitePreviewResponse,
} from '@circles/contracts';

import { inviteDigests } from '../_shared/digest.ts';
import { linkHandler } from '../_shared/link.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';

/**
 * What the Join page shows before anybody has joined (spec §5.1, S1-24):
 * the circle's name, who made the link, and one initial per member.
 *
 * It used to be a database call the browser made with the SHA-256 of the
 * fragment. The digest is an HMAC under `INVITE_DIGEST_KEY` since SUS-214
 * (ADR 0081), which a browser cannot hold, so the hashing moved here: the page
 * posts the fragment, this hashes it and asks `public.invite_preview`, which is
 * the service role's.
 *
 * No session, because the page is shown before any prompt and a sign-in in front
 * of it would be one (§5.1). The secret is the authorisation. It is a 256-bit
 * value, so a script cannot walk it, but this endpoint can be asked by anybody,
 * unlike a stored digest, so it carries a per-address limit. Without
 * `INVITE_DIGEST_KEY` it answers 503 and looks nothing up.
 *
 * The answer is `{ preview: null }` for every link that is not live, because the
 * caller is not entitled to know whether it was revoked, unknown or archived.
 * The secret is in the request body only: not in a URL, a log line or an error.
 */
Deno.serve(
  linkHandler({
    name: 'invite-preview',
    schema: InvitePreviewRequest,
    handle: async ({ body, service, request }): Promise<InvitePreviewResponse> => {
      // The key first: a deployment without it must not spend the caller's allowance.
      const digests = await inviteDigests(body.secret);

      await enforce(service, [
        { scope: 'invite_preview_ip', key: callerAddress(request), max: 120, window: '1 hour' },
      ]);

      const { data, error } = await service.rpc('invite_preview', {
        p_secret_hash: digests.current,
        p_legacy_hash: digests.legacy,
      });
      if (error !== null) throw error;

      const row = (data ?? [])[0];
      return { preview: row === undefined ? null : InvitePreview.parse(row) };
    },
  }),
);
