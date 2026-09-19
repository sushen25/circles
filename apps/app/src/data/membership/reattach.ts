import {
  GuestMemberOption,
  ReattachMemberResponse,
  type CircleId,
  type IdempotencyKey,
  type ShortCode,
  type UserId,
} from '@circles/contracts';
import { z } from 'zod';

import { authClient } from '../auth/client';
import { ensureGuestSession } from '../auth/guest';
import { invokeFunction } from '../functions';

/**
 * Coming back with no session: "Continue as" and the emailed way in (ADR 0006,
 * spec §5.1).
 *
 * Both need a session *before* they start. The list is granted to
 * `authenticated` and not to `anon`, and a reattachment moves a membership
 * onto the caller, so there has to be a caller. `ensureGuestSession` is
 * idempotent, which is what makes calling it at the top of each of these safe.
 */

/** Why the list could not be read, when the answer is not an error page. */
export type GuestListResult =
  | { kind: 'listed'; members: readonly GuestMemberOption[] }
  /** Thirty lookups an hour per caller. A person never meets it; a script does. */
  | { kind: 'limited' };

/**
 * The circle's guest members by display name, from a circle or plan short code.
 *
 * Names and ids only, and the schema is where that is held: a column the
 * function grew would be stripped by the parse rather than rendered.
 */
export async function guestMembersFor(code: ShortCode): Promise<GuestListResult> {
  await ensureGuestSession();

  const { data, error } = await authClient().rpc('guest_members_for_reattach', {
    p_short_code: code,
  });

  if (error !== null) {
    // `raise exception 'too_many_requests'` reaches PostgREST as its message.
    if (error.message === 'too_many_requests') return { kind: 'limited' };
    throw new Error('guest list lookup failed');
  }

  return { kind: 'listed', members: z.array(GuestMemberOption).parse(data ?? []) };
}

export interface ReattachFromListOptions {
  circleId: CircleId;
  memberUserId: UserId;
  idempotencyKey: IdempotencyKey;
}

/** "Continue as Priya": move Priya's guest membership onto this session. */
export async function reattachFromList({
  circleId,
  memberUserId,
  idempotencyKey,
}: ReattachFromListOptions): Promise<ReattachMemberResponse> {
  await ensureGuestSession();
  return await invokeFunction(
    'reattach-member',
    {
      idempotency_key: idempotencyKey,
      circle_id: circleId,
      target_member_user_id: memberUserId,
    },
    ReattachMemberResponse,
  );
}

/**
 * The emailed `/a#<token>` link: the same reattachment, authorised by the token
 * instead of by a pick from the list. The token is single-use and never logged;
 * it goes in the body and nowhere else.
 */
export async function reattachWithToken(
  token: string,
  idempotencyKey: IdempotencyKey,
): Promise<ReattachMemberResponse> {
  await ensureGuestSession();
  return await invokeFunction(
    'reattach-member',
    { idempotency_key: idempotencyKey, reentry_token: token },
    ReattachMemberResponse,
  );
}

/**
 * The circle's name for a plan code, for the Continue-as title.
 *
 * A non-member can read nothing about the circle through RLS, and the list
 * does not carry the name. `preview_for_code` already tells a stranger holding
 * only a short code the circle's name — it already does, to every chat app that unfurls
 * the link — so this asks it rather than widening the list.
 */
export async function circleNameForCode(code: ShortCode): Promise<string | null> {
  const { data, error } = await authClient().rpc('preview_for_code', { p_kind: 'p', p_code: code });
  // Thrown, not answered as null. Null means "no circle behind this code", and
  // a screen acts on that — the account's join sends it to the invite state —
  // so a dropped connection must not look like it. It is an error, with Retry.
  if (error !== null) throw new Error('circle name lookup failed');
  return data ?? null;
}
