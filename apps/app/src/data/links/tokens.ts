import { fragmentLinkKind, parseTokenLink, type OpaqueToken } from '@circles/contracts';

/**
 * Emailed tokens, taken out of the address bar before the router sees them
 * (ADR 0023).
 *
 * `/a#<token>`, `/v#<token>` and `/e#<token>` carry their token in the
 * fragment so that no server — the web host, a proxy, a scanner that records
 * URLs — ever holds it. The router would undo that: expo-router reads
 * `window.location` when its module is evaluated and writes the fragment back
 * into history on every update. So, like the circle invite
 * (`captureInviteFragment`), the token is taken here, from the app's entry
 * point, before `expo-router/entry` is imported, and held in memory for the one
 * screen that posts it to its function.
 *
 * Memory only, and on purpose. A reload after the capture finds nothing and the
 * screen says to open the link from the email again: keeping the token anywhere
 * that survives a reload is keeping it somewhere else to leak from.
 */
export type TokenKind = 'reentry' | 'verify' | 'preferences';

const held = new Map<TokenKind, OpaqueToken>();

/**
 * Holds the token a URL's fragment carries, if it is one of these links. True
 * when the fragment must now be taken off the URL — cleared whether or not it
 * parsed: a malformed token is still a token-shaped thing somebody was sent,
 * and it has no business in an address bar or in the router's state.
 *
 * The one rule for both doors: the web's address bar (`captureTokenFragment`)
 * and the app's incoming link (`routeIncomingLink`, S3-01a).
 */
export function takeTokenFragment(pathname: string, hash: string): boolean {
  const kind = fragmentLinkKind(pathname);
  if (hash === '' || hash === '#' || kind === null || kind === 'invite') return false;
  const parsed = parseTokenLink(hash);
  if (parsed === null) held.delete(kind);
  else held.set(kind, parsed.token);
  return true;
}

export function captureTokenFragment(): void {
  if (typeof window === 'undefined' || window.location === undefined) return;
  const { pathname, search, hash } = window.location;
  if (!takeTokenFragment(pathname, hash)) return;
  window.history.replaceState(window.history.state, '', pathname + search);
}

/** The token this page was opened with, if it was one of these links. */
export function heldToken(kind: TokenKind): OpaqueToken | undefined {
  return held.get(kind);
}

/**
 * A screen that has taken its token lets go of the held copy, so that nothing
 * later in this tab — a bare `/e` opened by whoever has the browser next — can
 * use it without the email (ADR 0023: held "for the one screen that needs it").
 * Two steps rather than a destructive read, because React may run a state
 * initialiser twice and the second run would find nothing.
 */
export function releaseToken(kind: TokenKind): void {
  held.delete(kind);
}

/** Tests only: what `captureTokenFragment` would have held. */
export function holdTokenForTests(kind: TokenKind, token: OpaqueToken): void {
  held.set(kind, token);
}
