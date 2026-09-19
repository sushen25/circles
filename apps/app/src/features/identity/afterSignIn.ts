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
 * - **In a circle already**: that circle's home — the newest they joined.
 *   The ticket says their circles list, and that is where this goes once the
 *   list is live (S1-23); until then `/circles` is fixtures, and a returning
 *   organiser sent there could not reach a real circle at all (review round 3).
 *   Otherwise, their first circle.
 */
export type AfterSignIn = {
  next?: string | undefined;
  hasName: boolean;
  /** The circle they joined most recently, if they are in any. */
  circleId: string | undefined;
};

export function destinationAfterSignIn({ next, hasName, circleId }: AfterSignIn): string {
  if (next !== undefined) return next;
  if (!hasName) return '/name';
  return afterNaming(circleId);
}

/** After Your name: their newest circle if they have one, else the first one. */
export function afterNaming(circleId: string | undefined): string {
  return circleId === undefined ? '/circles/new' : `/circles/${circleId}`;
}
