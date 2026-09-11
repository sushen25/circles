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

export async function actorFrom(db: Db, token: string): Promise<Actor | undefined> {
  const { data, error } = await db.auth.getUser(token);
  if (error !== null || data.user === null) return undefined;
  return {
    userId: data.user.id as UserId,
    isAnonymous: data.user.is_anonymous === true,
  };
}

/** The bearer token itself, or nothing. Case-insensitive, as the RFC has it. */
export function bearerOf(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^bearer[ ]+(?<token>[^ ]+)$/i.exec(header.trim());
  return match?.groups?.token;
}
