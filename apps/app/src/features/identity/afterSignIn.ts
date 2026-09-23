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
 * - **In a circle already**: their circles list (S1-23), which reads their
 *   real circles. Otherwise, their first circle.
 */
export type AfterSignIn = {
  next?: string | undefined;
  hasName: boolean;
  /** The circle they joined most recently, if they are in any: only whether there is one matters. */
  circleId: string | undefined;
};

export function destinationAfterSignIn({ next, hasName, circleId }: AfterSignIn): string {
  if (next !== undefined) return next;
  if (!hasName) return '/name';
  return afterNaming(circleId);
}

/** After Your name: their circles if they have any, else the first one. */
export function afterNaming(circleId: string | undefined): string {
  return circleId === undefined ? '/circles/new' : '/circles';
}
