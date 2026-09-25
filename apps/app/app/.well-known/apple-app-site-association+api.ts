import { APPLE_APP_SITE_ASSOCIATION } from '../../src/data/links/wellKnown';

/**
 * `/.well-known/apple-app-site-association` (S3-01a). A route only so that it
 * is served as JSON: `src/data/links/wellKnown.ts` says why. Straight from the
 * path, never a redirect — Apple's CDN does not follow one.
 */
export function GET(): Response {
  return Response.json(APPLE_APP_SITE_ASSOCIATION);
}
