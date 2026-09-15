import { authClient } from '../client';
import type { SignedIn } from './types';

/**
 * Email-code sign-in, and email as a way for a guest to save their place
 * (architecture §10, spec §5.1).
 *
 * A six-digit code, never a magic link. That is not a preference: a link
 * opened in a mail app's in-app browser lands in a *different* storage jar from
 * the one the person was joining in, so the session arrives somewhere they
 * cannot see it — which is the failure Continue-as exists to repair, caused on
 * purpose. A code is typed into the tab that is already open.
 *
 * **The template is what makes that true, and only locally so far.**
 * `supabase/templates/magic-link.html` overrides the stock template on the
 * local stack to send `{{ .Token }}`; both hosted projects still carry
 * Supabase's own, which sends `{{ .ConfirmationURL }}`. Test against local —
 * `pnpm mail <address>` prints the code — or you are exercising a flow this
 * module does not implement. Fixing the hosted templates is S1-19's.
 */

/**
 * Two verification types, and picking the wrong one fails at the last step.
 *
 * `'email'` completes a sign-in for an identity that already owns the address.
 * `'email_change'` completes the *addition* of an address to a user who is
 * signed in — which is what converting an anonymous guest is, as far as the
 * auth server is concerned. A code minted by one flow is not accepted by the
 * other, so the two paths below never share a helper that guesses.
 */
type EmailOtpType = 'email' | 'email_change';

async function verify(address: string, code: string, type: EmailOtpType): Promise<SignedIn> {
  const { data, error } = await authClient().auth.verifyOtp({
    email: address,
    token: code,
    type,
  });

  if (error !== null) throw error;
  if (data.session === null) throw new Error('verification returned no session');

  // Deliberately no `suggestedName`: see the note on `SignedIn`. An address is
  // not a name, and the local part is a guess at one.
  return { session: data.session };
}

/**
 * Step one of signing in: ask for a code.
 *
 * `shouldCreateUser: true` because this is also how a new organiser's account
 * comes into being (§5.1) — there is no separate sign-up. It does **not** sign
 * anyone in; it only sends.
 */
export async function requestSignInCode(address: string): Promise<void> {
  const { error } = await authClient().auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: true },
  });
  if (error !== null) throw error;
}

/** Step two: exchange the code for a session. */
export async function submitSignInCode(address: string, code: string): Promise<SignedIn> {
  return await verify(address, code, 'email');
}

/**
 * Which route saving a place took, because step two has to match it.
 *
 * - `new_identity` — the address was unused, so the anonymous user *became*
 *   permanent in place. Same id; nothing to merge.
 * - `existing_account` — the address already belonged to somebody, so the
 *   anonymous session is replaced by **that** account's. Different id, and the
 *   guest's memberships have to be carried across, which is exactly what
 *   `claim-identity` is for (§10: "reconcile memberships if the permanent
 *   identity already existed").
 *
 * Returned rather than remembered, because the two steps are on different
 * routes: the address is typed on one screen and the code on another, and a
 * module holding "which flow are we in" across a navigation is a bug waiting
 * for a refresh.
 */
export type LinkRoute = 'new_identity' | 'existing_account';

/**
 * Step one of a guest saving their place.
 *
 * **`linkIdentity` is not this.** It looks like the right call and the ticket
 * named it, but `supabase-js` types it for `SignInWithOAuthCredentials` and
 * `SignInWithIdTokenCredentials` only — it is the SSO path, and S1-14b will use
 * it for exactly that. There is no email variant.
 *
 * **And `updateUser` alone is not enough either.** It refuses an address that
 * already has an account, with `email_exists` (422) — which is not an edge
 * case but the *return visit*: somebody who made an account on their laptop,
 * then answered a plan link on their phone as a guest. Without the fallback
 * below they simply cannot save their place, and the memberships §10 promises
 * to reconcile never get the chance.
 */
export async function requestLinkCode(address: string): Promise<LinkRoute> {
  const { error } = await authClient().auth.updateUser({ email: address });
  if (error === null) return 'new_identity';

  // The one refusal that is not a failure. Anything else is.
  const code = (error as { code?: string }).code;
  if (code !== 'email_exists') throw error;

  // Sign in to the account that already owns it. `shouldCreateUser: false`
  // because we know it exists — and because creating one here would silently
  // make a *third* identity if the check above were ever wrong.
  const { error: otpError } = await authClient().auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: false },
  });
  if (otpError !== null) throw otpError;
  return 'existing_account';
}

/**
 * Step two of saving a place, told which route step one took.
 *
 * The verification type is not interchangeable: a code minted for an email
 * change is not accepted as a sign-in and the reverse is also true, so guessing
 * — or trying one and falling back to the other — turns a wrong answer into a
 * confusing one.
 */
export async function submitLinkCode(
  address: string,
  code: string,
  route: LinkRoute,
): Promise<SignedIn> {
  return await verify(address, code, route === 'new_identity' ? 'email_change' : 'email');
}
