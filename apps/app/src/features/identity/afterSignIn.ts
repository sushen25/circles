/**
 * Where somebody goes once they are signed in (spec §5.1).
 *
 * - **Sent here from a plan link** ("I have an account", ADR 0022): straight
 *   back to it. The plan page's gate then decides — a member is let in, an
 *   account that is not one gets "Join <circle> as <name>". The path has
 *   already been through `safeReturnPath`.
 * - **No name yet**: Your name. A returning account that already has one never
 *   sees that screen again — which is how "returning Apple/Google users skip
 *   name entry" reads for the email path until SSO exists (SUS-77).
 * - **In a circle already**: their circles. Otherwise, their first circle.
 */
export type AfterSignIn = {
  next?: string | undefined;
  hasName: boolean;
  hasCircles: boolean;
};

export function destinationAfterSignIn({ next, hasName, hasCircles }: AfterSignIn): string {
  if (next !== undefined) return next;
  if (!hasName) return '/name';
  return afterNaming(hasCircles);
}

/** After Your name: their circles if they have any, else the first one. */
export function afterNaming(hasCircles: boolean): string {
  return hasCircles ? '/circles' : '/circles/new';
}
