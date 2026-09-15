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
 * The link in the verification email, minted at the moment it is sent.
 *
 * Not when the person asked: a token minted there has no way of reaching the
 * letter. `jobs.notification_jobs` carries ids and no payload, the outbox
 * refuses a key called `token`, and the token row holds a digest — so the
 * readable half would simply be dropped, which is what an earlier draft did
 * (ADR 0020). `request_email_updates` writes the job; S1-20's dispatcher drains
 * it and comes here.
 *
 * **Null means skip this job.** By the time it is drained the contact may have
 * been verified by another link, suppressed by a bounce, or removed by its
 * owner. None of those is a failure to retry, and the previous token is spent
 * only when a new one replaces it (spec §5.8's "resend invalidates").
 */
export async function issueVerificationToken(
  service: Db,
  contactId: string,
): Promise<string | null> {
  const token = mintToken();
  const { data, error } = await service.rpc('issue_verification_token', {
    p_contact_id: contactId,
    p_token_hash: await tokenHash(token),
  });
  if (error !== null) throw error;
  return data === null ? null : token;
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
 *
 * **Null for a saved-place identity**, who needs no way back: the template
 * leaves the link out and the email is otherwise the same. That is an ordinary
 * outcome rather than an error — treating it as one made a permanent member's
 * event email unrenderable, since the table's guard raises a SQLSTATE the kit
 * turns into a 500.
 */
export async function issueReentryToken(
  service: Db,
  circleId: string,
  userId: string,
): Promise<string | null> {
  const token = mintToken();
  const { data, error } = await service.rpc('issue_reentry_token', {
    p_circle_id: circleId,
    p_user_id: userId,
    p_token_hash: await tokenHash(token),
  });
  if (error !== null) throw error;
  return data === null ? null : token;
}
