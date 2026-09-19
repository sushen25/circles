import { ShortCode } from '@circles/contracts';

/**
 * Where "I have an account" sends somebody back to after they sign in
 * (ADR 0022, SUS-80).
 *
 * **Only a plan link, and only as a path on this origin.** The value arrives in
 * a query string that anybody can write, so anything wider is an open
 * redirect: `/sign-in?next=https://elsewhere.example` would put our sign-in
 * screen in front of somebody else's page. So this is an allow-list of two
 * shapes, `/j/<code>` and `/p/<code>`, with the code checked against the same
 * schema the routes use — not a check that the string "looks relative", which
 * `//elsewhere.example` and `/\elsewhere.example` both pass.
 *
 * A plan's short code is not a token (ADR 0022); an invite secret is, and it
 * lives in `/join#…`, which is deliberately not a shape this accepts.
 */
const PLAN_PATH = /^\/(j|p)\/([^/?#\\]+)$/;

export function safeReturnPath(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;

  const match = PLAN_PATH.exec(value);
  if (match === null) return undefined;

  const code = ShortCode.safeParse(match[2]);
  if (!code.success) return undefined;
  return `/${match[1]}/${code.data}`;
}
