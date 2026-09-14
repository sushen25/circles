import type { Db } from './db.ts';
import { sha256Hex } from './hash.ts';

/**
 * Tokens that arrive in an email and let somebody act without signing in.
 *
 * Three purposes, one shape: 32 random bytes, base64url so they survive a mail
 * client's line wrapping and a copy-paste, hashed on the way into the database
 * and never stored as themselves (§14). The readable form exists in exactly two
 * places — the link in the email, and this function's return value on the way
 * there.
 *
 * They are minted here rather than in Postgres for the reason the invite secret
 * is: a token generated in SQL is a token that has been a statement parameter,
 * and statement parameters end up in logs.
 */
export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The stored form: `\x…` hex of the SHA-256, which is what a `bytea` takes. */
export function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * The single-use link back into a circle for a guest with no session.
 *
 * Every event email carries one (spec §5.8, §5.11): a guest who reads it on a
 * new phone has no way back otherwise, and "a guest returns with no session" is
 * the most common real thing that happens (§9). Seven days, single use, and
 * refused at issue for a saved-place identity — for them a re-entry link would
 * be a sign-in bypass, which `enforce_reentry_for_guests` makes impossible
 * rather than unlikely.
 *
 * Here, in the kit, because the templates that embed it are S1-19's and the
 * dispatcher that renders them is S1-20's: both need one link per email, and
 * neither should be minting capabilities of its own.
 */
export async function issueReentryToken(
  service: Db,
  circleId: string,
  userId: string,
): Promise<string> {
  const token = mintToken();
  const { error } = await service.rpc('issue_reentry_token', {
    p_circle_id: circleId,
    p_user_id: userId,
    p_token_hash: await tokenHash(token),
  });
  if (error !== null) throw error;
  return token;
}
