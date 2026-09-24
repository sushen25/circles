import { NOTIFICATION_SETTINGS_PATH, ShortCode } from '@circles/contracts';

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

/**
 * And one more shape, for the organiser gate: a circle's first-plan screen,
 * `/circles/<uuid>/plan/new`, where a guest member is sent to save their place
 * before they can organise (ADR 0004) and should come back to (review round 4).
 * The id is checked as a UUID, so nothing else can ride along.
 */
const FIRST_PLAN_PATH =
  /^\/circles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/plan\/new$/;

/**
 * And notification settings, exactly: the organiser emails' footer links there
 * (ADR 0029), and somebody reading one on a signed-out browser should land on
 * the switch after signing in, not on their circles. A fixed string, compared
 * whole, so nothing can ride along.
 */
const SETTINGS_PATHS: readonly string[] = [NOTIFICATION_SETTINGS_PATH];

export function safeReturnPath(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;

  if (SETTINGS_PATHS.includes(value)) return value;

  const firstPlan = FIRST_PLAN_PATH.exec(value);
  if (firstPlan !== null) return `/circles/${firstPlan[1]}/plan/new`;

  const match = PLAN_PATH.exec(value);
  if (match === null) return undefined;

  const code = ShortCode.safeParse(match[2]);
  if (!code.success) return undefined;
  return `/${match[1]}/${code.data}`;
}
