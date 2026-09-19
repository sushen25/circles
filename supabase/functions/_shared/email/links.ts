import {
  OpaqueToken,
  ShortCode,
  emailPreferencesUrl,
  emailVerifyUrl,
  planUrl,
  reentryUrl,
} from '@circles/contracts';

import type { SubscriberFooter } from './templates/Layout.tsx';

/**
 * Every link an email carries, built by the contract's functions and nothing
 * else (ADR 0023): the three token links put the token in the fragment, which
 * no server receives, and the plan link carries a short code, which is not a
 * token (ADR 0022).
 *
 * A token that is not token-shaped is refused here rather than written into a
 * letter as a link that cannot work. The error names the *kind* of value and
 * never the value: a `ZodError` would carry the issue, and an issue can carry
 * its input.
 */

export class EmailLinkError extends Error {
  constructor(readonly field: 'token' | 'plan_code' | 'circle_id' | 'origin') {
    super(`email_link_invalid: ${field}`);
    this.name = 'EmailLinkError';
  }
}

function token(value: string): OpaqueToken {
  const parsed = OpaqueToken.safeParse(value);
  if (!parsed.success) throw new EmailLinkError('token');
  return parsed.data;
}

function code(value: string): ShortCode {
  const parsed = ShortCode.safeParse(value);
  if (!parsed.success) throw new EmailLinkError('plan_code');
  return parsed.data;
}

/**
 * `https://host` and nothing after it. A path or a query here would sit in
 * front of every link's `#`, and a fragment would swallow the token's.
 */
function origin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EmailLinkError('origin');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new EmailLinkError('origin');
  return url.origin;
}

export function verifyLink(at: string, verifyToken: string): string {
  return emailVerifyUrl(origin(at), token(verifyToken));
}

export function planLink(at: string, planCode: string): string {
  return planUrl(origin(at), code(planCode));
}

/** `/circles/<id>` — the about-time nudge is about a circle, not a plan. */
export function circleLink(at: string, circleId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(circleId)) {
    throw new EmailLinkError('circle_id');
  }
  return `${origin(at)}/circles/${circleId}`;
}

/**
 * Both footer links open `/e#<token>`.
 *
 * "Stop emails for this meetup" and "Manage email preferences" go to the same
 * page, which lists this meetup with a one-tap stop beside it. The page does not
 * read a plan from its link (`EmailPrefsFlow`), and giving it one would mean a
 * second value in the fragment beside the token — a client change for S1-30's
 * screen, and a new link shape in `deeplinks.ts` — to save one tap on an
 * unsubscribe that already takes one. A plan id in the path or query instead
 * would put "somebody at this address is in this plan" into the host's request
 * log, which is the thing ADR 0023 moved the tokens out of it to avoid.
 */
export function subscriberFooter(input: {
  origin: string;
  circleName: string;
  prefsToken: string;
  reentryToken: string | null;
}): SubscriberFooter {
  const prefs = emailPreferencesUrl(origin(input.origin), token(input.prefsToken));
  return {
    kind: 'subscriber',
    circleName: input.circleName,
    stopPlanUrl: prefs,
    manageUrl: prefs,
    reentryUrl:
      input.reentryToken === null
        ? undefined
        : reentryUrl(origin(input.origin), token(input.reentryToken)),
  };
}
