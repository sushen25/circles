import type { Session } from '@supabase/supabase-js';

/**
 * The seam every sign-in method goes through (architecture §10).
 *
 * Three exist in the product — email code, Apple, Google — and only the first
 * is built here; S1-14b (SUS-77) adds the other two. The shape is settled now
 * so that adding them is a new file rather than a change to every caller.
 *
 * **Why a module per provider and not one polymorphic object.** The two SSO
 * providers are single-step: a native SDK hands over an identity token and
 * `signInWithIdToken` returns a session. Email is two-step and the steps are on
 * *different routes* — the address is typed on one screen and the code on
 * another — so any interface that returned a continuation function from step
 * one would not survive the navigation between them. What the steps share is
 * the address, which is a string the caller already holds.
 *
 * So the common type is what a provider *ends at*, not how it gets there.
 */

export type ProviderId = 'email' | 'apple' | 'google';

/**
 * What every provider hands back, whatever it had to do to get there.
 *
 * `suggestedName` is how §5.1 step 3's "prefilled from the SSO provider" is
 * honoured without the profile bootstrap knowing which provider ran. Email has
 * nothing to suggest — an address is not a name, and deriving one from the
 * local part guesses at a person's name from a string they chose for a mail
 * server. So the Your name screen starts empty on this path, and S1-14b passes
 * `user_metadata.full_name` here without touching `profile.ts`.
 */
export interface SignedIn {
  session: Session;
  suggestedName?: string;
}
