import { JoinPlanResponse, type IdempotencyKey, type ShortCode } from '@circles/contracts';

import { ensureGuestSession } from '../auth/guest';
import { getTurnstileToken } from '../auth/turnstile';
import { FunctionError, invokeFunction, newIdempotencyKey } from '../functions';

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

export type AskOutcome = 'asked' | 'closed' | 'failed';

/**
 * A member the plan is not asking, asked (ADR 0022: "opening that plan's link
 * asks them"). `join-plan` with no name, which for a member adds the
 * participant row and nothing else.
 *
 * Nobody is watching this happen — it runs behind the plan page — so a
 * transient failure is retried here rather than left for the person to find
 * when their answer is refused: three attempts, one idempotency key, since they
 * are one request. `invite_inactive` is an answer, not a failure: the plan
 * stopped asking, and trying again will not change that.
 */
export async function askToPlan(
  code: ShortCode,
  delays: readonly number[] = [1_000, 4_000],
): Promise<AskOutcome> {
  const idempotencyKey = newIdempotencyKey();
  for (let attempt = 0; ; attempt += 1) {
    try {
      await joinPlan({ code, idempotencyKey });
      return 'asked';
    } catch (error) {
      if (error instanceof FunctionError && error.reason === 'invite_inactive') return 'closed';
      const wait = delays[attempt];
      if (wait === undefined) return 'failed';
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
