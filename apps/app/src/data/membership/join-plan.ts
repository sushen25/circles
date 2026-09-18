import { JoinPlanResponse, type IdempotencyKey, type ShortCode } from '@circles/contracts';

import { ensureGuestSession } from '../auth/guest';
import { getTurnstileToken } from '../auth/turnstile';
import { invokeFunction } from '../functions';

/**
 * Joining a circle from a plan's link, as somebody that plan is asking
 * (ADR 0022).
 *
 * The plan's short code is what authorises it, and only while the plan is
 * taking answers. A non-member cannot read the plan through RLS, so the client
 * cannot know in advance whether it is: it asks, and `invite_inactive` is the
 * answer for every plan that is not admitting and for a code that does not
 * exist alike.
 */

export interface JoinPlanOptions {
  code: ShortCode;
  /**
   * Required for a guest. Left out by an account, which joins under its
   * profile's name, and by a member the plan never asked, whose name is not
   * read. A name sent by an account names it in this circle only.
   */
  displayName?: string;
  /** The same key for a retry of the same name; a new one when the name changes. */
  idempotencyKey: IdempotencyKey;
}

export async function joinPlan({
  code,
  displayName,
  idempotencyKey,
}: JoinPlanOptions): Promise<JoinPlanResponse> {
  // Idempotent: a guest who has one keeps it, and an account is left alone.
  await ensureGuestSession();
  // Its own token: one cannot satisfy two verifications (see `redeemInvite`).
  const turnstileToken = await getTurnstileToken();

  return await invokeFunction(
    'join-plan',
    {
      idempotency_key: idempotencyKey,
      plan_code: code,
      ...(displayName === undefined ? {} : { display_name: displayName }),
      ...(turnstileToken === undefined ? {} : { turnstile_token: turnstileToken }),
    },
    JoinPlanResponse,
  );
}
