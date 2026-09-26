import appSiteAssociation from './apple-app-site-association.json';

/**
 * The Apple app-site association (S3-01a, architecture §5.2): which builds may
 * open which paths on the link host. S3-01b replaces `TEAMID` with the Apple
 * team id; the paths are `APP_LINK_PATHS`, which `appLinks.test.ts` holds this
 * to.
 *
 * Served by a route rather than from `public/`, and that is the whole reason
 * it is here. The file's name has no extension, and a static file with no
 * extension is served as `application/octet-stream` — by `expo serve`, which
 * the smoke suite found, and by any host that types files by their name.
 * Apple's CDN wants `application/json`. `assetlinks.json` has the extension
 * and stays a static file in `public/.well-known/`.
 */
export const APPLE_APP_SITE_ASSOCIATION: unknown = appSiteAssociation;
