import { DEEP_LINK_ROUTES } from '@circles/contracts';

/**
 * The circle's invite link, while this tab holds it.
 *
 * The secret arrives from `create-circle`, from `rotate-invite` ("Reset link")
 * or from `get-invite-link` (the owner asking for it again, ADR 00XX), and only
 * its SHA-256 is stored server-side (§14). It is kept here, in memory, for the
 * screens that share it — InviteCircle, "Share again" and "Invite link" on the
 * circle home, "Copy link" in settings — and nowhere that outlives the tab: not
 * a URL, not storage, not a query key, not analytics. A reload loses it, and the
 * owner's screens ask `get-invite-link` again. Keeping it in storage would be
 * keeping a capability somewhere else to leak from.
 *
 * Keyed by circle, so a second circle made in the same tab does not hand the
 * first one's link to the wrong group.
 */
const held = new Map<string, string>();

export function keepInviteSecret(circleId: string, secret: string): void {
  held.set(circleId, secret);
}

/** The link for `circleId`, if this tab holds its secret; undefined after a reload. */
export function heldInviteLink(circleId: string, origin: string): string | undefined {
  const secret = held.get(circleId);
  return secret === undefined ? undefined : inviteLink(origin, secret);
}

/**
 * `${origin}/join#${secret}` — the secret in the fragment, which no server
 * sees (architecture §5.2, ADR 0023).
 */
export function inviteLink(origin: string, secret: string): string {
  return `${origin.replace(/\/+$/, '')}${DEEP_LINK_ROUTES.join}#${secret}`;
}

/** Drops every held secret, so a test starts from nothing. */
export function forgetInviteSecretsForTests(): void {
  held.clear();
}
