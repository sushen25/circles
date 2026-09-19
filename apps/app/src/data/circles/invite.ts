import { DEEP_LINK_ROUTES } from '@circles/contracts';

/**
 * The circle's invite link, from the one moment the client ever holds it.
 *
 * `create-circle` returns the secret **once**; only its SHA-256 is stored, so
 * nothing can hand it back later (§14). It is kept here, in memory, between
 * FirstCircle and the two screens that share it — InviteCircle and "Share
 * again" on the circle home — and nowhere that outlives the tab: not a URL,
 * not storage, not a query key, not analytics. A reload loses it, and the
 * screens say so and point at the circle's settings, where the owner resets the
 * link (S1-23). Keeping it in storage would be keeping a capability somewhere
 * else to leak from.
 *
 * Keyed by circle, so a second circle made in the same tab does not hand the
 * first one's link to the wrong group.
 */
const held = new Map<string, string>();

export function keepInviteSecret(circleId: string, secret: string): void {
  held.set(circleId, secret);
}

/** The link for `circleId`, if this tab made it; undefined after a reload. */
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
