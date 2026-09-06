import { z } from 'zod';

import { OpaqueToken, ShortCode } from './ids.js';

/**
 * The six links the product puts into the world (architecture §5.2).
 *
 * The circle invite carries its secret in the **fragment**, which browsers do
 * not send to a server: it reaches the client only, and the client hands it to
 * `redeem-invite` over https. That is why `JoinLink` is parsed from a hash and
 * the others from a path — the shape of these schemas is a privacy boundary,
 * not a formatting preference (§9.4).
 */

/** `/join#<secret>` — circle invite. The secret never appears in a request line. */
export const JoinLink = z.object({ secret: z.string().min(16).max(256) });
export type JoinLink = z.infer<typeof JoinLink>;

/** `/j/:code` — plan invite short link. Resolves client-side; carries no secret. */
export const PlanInviteLink = z.object({ code: ShortCode });
export type PlanInviteLink = z.infer<typeof PlanInviteLink>;

/** `/p/:code` — the plan page. */
export const PlanLink = z.object({ code: ShortCode });
export type PlanLink = z.infer<typeof PlanLink>;

/** `/a/:token` — re-entry from an email. Single use. */
export const ReentryLink = z.object({ token: OpaqueToken });
export type ReentryLink = z.infer<typeof ReentryLink>;

/** `/e/:token` — email preferences, no sign-in. */
export const EmailPreferencesLink = z.object({ token: OpaqueToken });
export type EmailPreferencesLink = z.infer<typeof EmailPreferencesLink>;

/** `/v/:token` — email verification landing. */
export const EmailVerifyLink = z.object({ token: OpaqueToken });
export type EmailVerifyLink = z.infer<typeof EmailVerifyLink>;

/** Every reserved route, so the router and the domain agree on one list. */
export const DEEP_LINK_ROUTES = {
  join: '/join',
  planInvite: '/j/:code',
  plan: '/p/:code',
  reentry: '/a/:token',
  emailPreferences: '/e/:token',
  emailVerify: '/v/:token',
} as const;

/**
 * Pull the invite secret out of a URL's fragment. Returns null rather than
 * throwing: a malformed link is an ordinary thing for a person to arrive with,
 * and the screen says so plainly.
 */
export function parseJoinLink(url: string): JoinLink | null {
  const hash = url.split('#')[1];
  if (!hash) return null;
  const result = JoinLink.safeParse({ secret: decodeURIComponent(hash) });
  return result.success ? result.data : null;
}
