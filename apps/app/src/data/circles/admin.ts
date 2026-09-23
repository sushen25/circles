import {
  GetInviteLinkResponse,
  RemoveMemberResponse,
  RotateInviteResponse,
  type IdempotencyKey,
} from '@circles/contracts';

import { invokeFunction } from '../functions';
import { keepInviteSecret } from './invite';

/**
 * The owner's three functions (S1-23): the link again, a new link, and taking
 * somebody out. Each is the owner's alone and the server says so
 * (`not_the_owner`); the screens only offer them to the owner so nobody meets
 * that refusal by tapping.
 *
 * A secret that comes back is kept in memory for this tab and nowhere else
 * (`invite.ts`), exactly as `create-circle`'s is: not storage, not a URL, not a
 * query key, not analytics.
 */

/**
 * The live link's secret, or undefined when it cannot be shown again — a link
 * made before links could be, or on a deployment without the key (ADR 00XX).
 * The screen then offers a reset.
 */
export async function fetchInviteSecret(circleId: string): Promise<string | undefined> {
  const { invite_secret: secret } = await invokeFunction(
    'get-invite-link',
    { circle_id: circleId },
    GetInviteLinkResponse,
  );
  if (secret === null) return undefined;
  keepInviteSecret(circleId, secret);
  return secret;
}

/**
 * "Reset link": a new secret, the old link dead. The key is the caller's, held
 * for the confirmation sheet's life, so a retry after a lost response returns
 * the same new link instead of killing it with a second reset.
 */
export async function resetInviteLink(
  circleId: string,
  idempotencyKey: IdempotencyKey,
): Promise<string> {
  const { invite_secret: secret } = await invokeFunction(
    'rotate-invite',
    { idempotency_key: idempotencyKey, circle_id: circleId },
    RotateInviteResponse,
  );
  keepInviteSecret(circleId, secret);
  return secret;
}

export async function removeMember(
  circleId: string,
  userId: string,
  idempotencyKey: IdempotencyKey,
): Promise<void> {
  await invokeFunction(
    'remove-member',
    { idempotency_key: idempotencyKey, circle_id: circleId, user_id: userId },
    RemoveMemberResponse,
  );
}
