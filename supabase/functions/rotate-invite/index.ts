import { RotateInviteRequest, type RotateInviteResponse } from '@circles/contracts';

import { optional } from '../_shared/env.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { jsonHandler } from '../_shared/http.ts';
import { enforce } from '../_shared/rate.ts';
import { newInvite } from '../_shared/secret.ts';

/**
 * "Reset link" (spec §5.2, S1-23): a new invite secret, and the old one dead.
 *
 * `public.issue_invite` does the whole of it — the owner's alone
 * (`not_the_owner`), revoking every earlier link in the same statement, the
 * audit row, and `circles.invite_rotated` — so this is the part the database
 * cannot do: making the secret. It is derived from a fresh invite id under
 * `INVITE_LINK_KEY` (ADR 00XX) so the owner can be shown it again later, and
 * only its digest reaches the database (§14).
 *
 * Idempotent on the key: the record keeps the response, secret included, for
 * the retry window — the exposure `create-circle` already accepts, for the same
 * reason. A retry that rotated again would kill the link the first attempt
 * made, possibly after it had been pasted into a chat.
 */
Deno.serve(
  jsonHandler({
    name: 'rotate-invite',
    schema: RotateInviteRequest,
    guard: async ({ actor, service }) => {
      // Volume, not permission: an owner resetting in a loop is not a thing a
      // person does, and each reset writes an audit row and an event.
      await enforce(service, [
        { scope: 'rotate_invite', key: actor.userId, max: 20, window: '1 hour' },
      ]);
    },
    handle: async ({ body, caller }): Promise<RotateInviteResponse> => {
      const { inviteId, secret } = await newInvite(optional('INVITE_LINK_KEY'));
      const { error } = await caller.rpc('issue_invite', {
        p_circle_id: body.circle_id,
        p_secret_hash: await sha256Hex(secret),
        ...(inviteId === undefined ? {} : { p_invite_id: inviteId }),
      });
      if (error !== null) throw error;

      return { invite_secret: secret };
    },
  }),
);
