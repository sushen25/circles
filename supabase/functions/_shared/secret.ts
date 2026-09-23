/**
 * A capability nobody can guess.
 *
 * 32 bytes from the platform's CSPRNG — §14's "≥256-bit secret in the URL
 * fragment" — encoded base64url so it survives a fragment, a chat message and a
 * copy-paste without escaping. `crypto.getRandomValues` and not `Math.random`,
 * which is not a question of taste: the invite secret is the only thing standing
 * between a link and a circle's roster.
 */
export function inviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

/**
 * An invite secret the owner can be shown again (ADR 0028).
 *
 * HMAC-SHA-256 of the invite's id under `INVITE_LINK_KEY`: 256 bits nobody can
 * produce without the key, and reproducible by anybody who has it and the id.
 * The database still stores only the SHA-256 of the result (§14), so a copy of
 * the database is no more a set of working links than it was — the key lives in
 * the Edge Functions' secrets beside the service role key, and never in a
 * table, a log or the client.
 *
 * The id is chosen here rather than by the database because the digest has to
 * exist before the row does: `issue_invite` takes both.
 */
export async function derivedInviteSecret(key: string, inviteId: string): Promise<string> {
  const encoder = new TextEncoder();
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    hmac,
    encoder.encode(`${INVITE_CONTEXT}${inviteId}`),
  );
  return base64url(new Uint8Array(mac));
}

/**
 * Domain separation: the same key may one day derive something else, and a
 * secret for one purpose must never be a secret for another.
 */
const INVITE_CONTEXT = 'circles.invite.v1:';

/** A new invite: its id, when the secret was derived from one, and the secret. */
export interface NewInvite {
  inviteId: string | undefined;
  secret: string;
}

/**
 * The secret for a new link. Derived when `INVITE_LINK_KEY` is set, so that
 * `get-invite-link` can show it again; random when it is not, which is the link
 * the product had before and still a link — just one that can only be reset.
 */
export async function newInvite(key: string | undefined): Promise<NewInvite> {
  if (key === undefined) return { inviteId: undefined, secret: inviteSecret() };
  const inviteId = crypto.randomUUID();
  return { inviteId, secret: await derivedInviteSecret(key, inviteId) };
}

function base64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
