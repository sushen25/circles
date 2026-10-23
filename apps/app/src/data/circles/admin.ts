import {
  GetInviteLinkResponse,
  LeaveCircleResponse,
  RemoveMemberResponse,
  RenameInCircleResponse,
  RotateInviteResponse,
  type IdempotencyKey,
} from '@circles/contracts';

import { invokeFunction } from '../functions';
import { keepInviteSecret } from './invite';

/**
 * The circle's three functions (S1-23): the invitation again, a new one, and
 * taking somebody out. **The first is any active member's** (ADR 0091:
 * `get-invite-link` refuses only somebody who is not in the circle, with
 * `not_a_member`); the other two are the owner's alone and the server says so
 * (`not_the_owner`), and the screens only offer them to the owner so nobody
 * meets that refusal by tapping.
 *
 * A secret that comes back is kept in memory for this tab and nowhere else
 * (`invite.ts`), exactly as `create-circle`'s is: not storage, not a URL, not a
 * query key, not analytics.
 */

/**
 * The live invitation's secret, or undefined when it cannot be shown again — one
 * made before they could be, or on a deployment without the key (ADR 0028).
 * The screen then says so, and the owner can cancel old invitations.
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
 * "Cancel old invitations": a new secret, the old invitations dead. The key is
 * the caller's, held for the confirmation sheet's life, so a retry after a lost
 * response returns the same new secret instead of killing it with a second
 * reset.
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

/** Leave a circle: the member's own removal (S4-05). Not the owner, who deletes their account. */
export async function leaveCircle(circleId: string, idempotencyKey: IdempotencyKey): Promise<void> {
  await invokeFunction(
    'leave-circle',
    { idempotency_key: idempotencyKey, circle_id: circleId },
    LeaveCircleResponse,
  );
}

/**
 * "Change my name here": the name this one circle calls the caller (SUS-205).
 * The caller's own membership only; the account name and every other circle
 * keep theirs. The key is the caller's, one per name, so a retry of the same
 * name after a lost response is answered from the record.
 */
export async function renameInCircle(
  circleId: string,
  displayName: string,
  idempotencyKey: IdempotencyKey,
): Promise<void> {
  await invokeFunction(
    'rename-in-circle',
    { idempotency_key: idempotencyKey, circle_id: circleId, display_name: displayName },
    RenameInCircleResponse,
  );
}
