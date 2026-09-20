import { z } from 'zod';

import { OpaqueToken, ShortCode } from './ids.js';

/**
 * The six links the product puts into the world (architecture §5.2).
 *
 * **Every capability rides in the fragment** — the circle invite's secret and
 * every emailed token — because browsers do not send a fragment to any server:
 * it reaches the client only, and the client hands it to its Edge Function over
 * https (ADR 0023). A token in a path is a token in the web host's request
 * logs. So these four are parsed from a hash and built by the functions below,
 * and nothing should write one by hand: the shape of these schemas is a privacy
 * boundary, not a formatting preference (§9.4).
 *
 * The two plan links carry a short code, which is not a token (ADR 0022).
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

/** `/a#<token>` — re-entry from an email. Single use. */
export const ReentryLink = z.object({ token: OpaqueToken });
export type ReentryLink = z.infer<typeof ReentryLink>;

/** `/e#<token>` — email preferences, no sign-in. Stays valid after use (ADR 0019). */
export const EmailPreferencesLink = z.object({ token: OpaqueToken });
export type EmailPreferencesLink = z.infer<typeof EmailPreferencesLink>;

/** `/v#<token>` — email verification landing. Single use. */
export const EmailVerifyLink = z.object({ token: OpaqueToken });
export type EmailVerifyLink = z.infer<typeof EmailVerifyLink>;

/**
 * Every reserved route, so the router and the domain agree on one list. The
 * capability links are bare paths: what they carry is in the fragment.
 */
export const DEEP_LINK_ROUTES = {
  join: '/join',
  planInvite: '/j/:code',
  plan: '/p/:code',
  reentry: '/a',
  emailPreferences: '/e',
  emailVerify: '/v',
} as const;

/** The routes whose fragment is a capability, and what each one carries. */
export const FRAGMENT_LINKS = {
  '/join': 'invite',
  '/a': 'reentry',
  '/v': 'verify',
  '/e': 'preferences',
} as const;
export type FragmentLinkKind = (typeof FRAGMENT_LINKS)[keyof typeof FRAGMENT_LINKS];

/** The kind of capability a path's fragment carries, or null for any other path. */
export function fragmentLinkKind(pathname: string): FragmentLinkKind | null {
  const path = pathname.replace(/\/+$/, '') as keyof typeof FRAGMENT_LINKS;
  return FRAGMENT_LINKS[path] ?? null;
}

function hashOf(url: string): string | null {
  const hash = url.split('#')[1];
  if (!hash) return null;
  try {
    return decodeURIComponent(hash);
  } catch {
    // A malformed escape (`#%`) is a broken link, not a reason to throw during
    // start-up, before the address bar is cleared or any screen can say so.
    return null;
  }
}

/**
 * Pull the invite secret out of a URL's fragment. Returns null rather than
 * throwing: a malformed link is an ordinary thing for a person to arrive with,
 * and the screen says so plainly.
 */
export function parseJoinLink(url: string): JoinLink | null {
  const secret = hashOf(url);
  if (secret === null) return null;
  const result = JoinLink.safeParse({ secret });
  return result.success ? result.data : null;
}

/** An emailed token from a URL's fragment, or null when there is none worth trying. */
export function parseTokenLink(url: string): { token: OpaqueToken } | null {
  const token = hashOf(url);
  if (token === null) return null;
  const result = ReentryLink.safeParse({ token });
  return result.success ? result.data : null;
}

/** `https://…/a#<token>`: the one way to write an emailed link (ADR 0023). */
export function reentryUrl(origin: string, token: OpaqueToken): string {
  return `${origin.replace(/\/+$/, '')}/a#${token}`;
}

export function emailVerifyUrl(origin: string, token: OpaqueToken): string {
  return `${origin.replace(/\/+$/, '')}/v#${token}`;
}

export function emailPreferencesUrl(origin: string, token: OpaqueToken): string {
  return `${origin.replace(/\/+$/, '')}/e#${token}`;
}

/**
 * `https://…/p/<code>`: the plan page. A short code is not a token (ADR 0022),
 * so it rides in the path like every plan link pasted into a chat.
 */
export function planUrl(origin: string, code: ShortCode): string {
  return `${origin.replace(/\/+$/, '')}/p/${code}`;
}
