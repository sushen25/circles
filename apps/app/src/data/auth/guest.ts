import type { Session } from '@supabase/supabase-js';

import { authClient } from './client';
import { getTurnstileToken } from './turnstile';

/**
 * The anonymous session a guest gets on first contact (architecture §10).
 *
 * Every route a guest can reach needs one, and needs it *before* the thing it
 * is for: `public.guest_members_for_reattach` is granted to `authenticated` and
 * not to `anon`, so even asking "who are the guests in this circle?" — the
 * Continue-as list — requires a session first. §10 calls that out and notes it
 * loses nothing, because a reattachment needs a session to move the membership
 * onto in any case.
 *
 * So this is the first call on the join and continue-as paths, not a step
 * inside them.
 */

/**
 * A Turnstile token is **single-use**, and two different things want one.
 *
 * Supabase Auth can be configured to require a captcha on `signInAnonymously`,
 * and `redeem-invite` verifies its own `turnstile_token` server-side. They are
 * separate checks against Cloudflare, and one token cannot satisfy both: the
 * second verification of the same token fails, which would look like a
 * challenge failure rather than a token already spent.
 *
 * So each consumer mints its own. `getTurnstileToken()` renders a fresh widget
 * per call, and nothing here caches or forwards a token it did not get for
 * itself. Passing one in is possible, for a caller that has just minted one and
 * has not used it, and is not the common path.
 *
 * Supabase Auth's captcha is **not** enabled on either project today
 * (`[auth.captcha]` is commented out in `config.toml`), so the token sent here
 * is ignored rather than checked. It is sent anyway: the day it is switched on,
 * anonymous sign-in should keep working rather than start failing, and a
 * parameter that is ignored costs one field.
 */
export interface GuestSessionOptions {
  /** A freshly minted, unspent token. Omit and one is minted here. */
  turnstileToken?: string;
}

/** The session, if there is one. Never throws: no session is an ordinary answer. */
export async function currentSession(): Promise<Session | null> {
  const { data } = await authClient().auth.getSession();
  return data.session;
}

/**
 * Returns the current session, or signs in anonymously and returns that.
 *
 * **Idempotent on purpose.** A guest opening a plan link runs the guard, the
 * Continue-as lookup and possibly a redeem in quick succession, and each of
 * them needs a session. Minting a second anonymous user for the same browser
 * would strand the first one's membership — the very thing Continue-as exists
 * to repair — so the existing session always wins, whatever tier it is.
 */
export async function ensureGuestSession(options: GuestSessionOptions = {}): Promise<Session> {
  const existing = await currentSession();
  if (existing !== null) return existing;

  const captchaToken = options.turnstileToken ?? (await getTurnstileToken());

  // The key is omitted rather than set to `undefined`: `exactOptionalPropertyTypes`
  // is on, and the two are different types even though they are the same call.
  // Native and a keyless local run therefore pass no captcha at all.
  const { data, error } = await authClient().auth.signInAnonymously(
    captchaToken === undefined ? {} : { options: { captchaToken } },
  );

  if (error !== null) throw error;
  if (data.session === null) {
    // Anonymous sign-in either returns a session or fails; a null session with
    // no error would mean a shape we do not understand, and continuing would
    // produce a much stranger failure three calls later.
    throw new Error('anonymous sign-in returned no session');
  }

  return data.session;
}

/**
 * Whether the caller is a guest rather than a saved place.
 *
 * Read from the JWT rather than from `profiles.is_permanent`, because the guards
 * run on every navigation and a database round trip per route change is a
 * spinner on every screen. The two agree: `claim-identity` is what sets
 * `is_permanent`, and it is called on the same path that replaces the session.
 */
export function isAnonymous(session: Session | null): boolean {
  return session?.user.is_anonymous === true;
}
