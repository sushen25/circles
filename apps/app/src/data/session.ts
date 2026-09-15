/**
 * The access token of whoever is signed in, for the parts of the app that are
 * not React and cannot ask a hook.
 *
 * One thing needs it today — the analytics transport, which sends from a module
 * rather than from a screen — and the auth module (S1-14) is what will set it,
 * on sign-in, on refresh and on sign-out. Until then it is null and every event
 * is attributed to nobody, which is honest: there is no session to attribute to.
 *
 * Deliberately not a store, a context or a client: whoever owns the session
 * pushes it here, and nothing here reaches back. That way the seam is a single
 * call rather than a dependency the analytics code has on the auth code.
 */

let token: string | undefined;

/** Called by the auth module whenever the session changes, and with `undefined` on sign-out. */
export function setAccessToken(next: string | undefined): void {
  token = next === '' ? undefined : next;
}

export function accessToken(): string | undefined {
  return token;
}
