import type { UserId } from '@circles/contracts';

import type { Db } from './db.ts';

/**
 * Who is asking.
 *
 * The JWT is verified by the auth server rather than decoded here, because a
 * decoded token is a token nobody checked: an unsigned `{"sub": …}` parses
 * perfectly. `getUser` costs a round trip and is the difference between
 * knowing who this is and believing them.
 *
 * `isAnonymous` comes from the same answer. It decides whether a caller may
 * reattach (ADR 0006) and whether Turnstile applies, so it is read from the
 * verified identity and never from a header the client sets.
 */
export interface Actor {
  userId: UserId;
  isAnonymous: boolean;
}

/**
 * Three answers, not two.
 *
 * `supabase-js` does not throw when it cannot reach the auth server: it returns an
 * `AuthRetryableFetchError` in `error`, with no HTTP status. Collapsing that to
 * "no actor" turned a network blip into "sign in and try again" on the main path,
 * and into "that session belongs to a different account" in `claim-identity` —
 * a reason the client branches *away* from retrying, about something that would
 * have worked a second later.
 */
export type Identification =
  | { readonly outcome: 'actor'; readonly actor: Actor }
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'unavailable' };

export async function identify(db: Db, token: string): Promise<Identification> {
  const { data, error } = await db.auth.getUser(token);

  if (error !== null) {
    // A rejection carries a status from the auth server; a failure to ask does not.
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? { outcome: 'rejected' } : { outcome: 'unavailable' };
  }

  if (data.user === null) return { outcome: 'rejected' };

  return {
    outcome: 'actor',
    actor: { userId: data.user.id as UserId, isAnonymous: data.user.is_anonymous === true },
  };
}

/** The bearer token itself, or nothing. Case-insensitive, as the RFC has it. */
export function bearerOf(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^bearer[ ]+(?<token>[^ ]+)$/i.exec(header.trim());
  return match?.groups?.token;
}
