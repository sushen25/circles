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
 * Step one of a guest saving their place: attach an address to the session
 * they already have.
 *
 * **`linkIdentity` is not this.** It looks like the right call and the ticket
 * named it, but `supabase-js` types it for `SignInWithOAuthCredentials` and
 * `SignInWithIdTokenCredentials` only — it is the SSO path, and S1-14b will use
 * it for exactly that. There is no email variant. Converting an anonymous user
 * with an address goes through `updateUser`, which sends a confirmation to the
 * new address, and `verifyOtp({ type: 'email_change' })`.
 *
 * The distinction matters beyond the call name: this keeps the **same user id**
 * and marks it permanent in place, so nothing needs to move. `claim-identity`
 * is still called afterwards — see `link.ts` for why that is not redundant.
 */
export async function requestLinkCode(address: string): Promise<void> {
  const { error } = await authClient().auth.updateUser({ email: address });
  if (error !== null) throw error;
}

/** Step two of saving a place. */
export async function submitLinkCode(address: string, code: string): Promise<SignedIn> {
  return await verify(address, code, 'email_change');
}
