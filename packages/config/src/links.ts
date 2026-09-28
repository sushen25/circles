/**
 * The paths the installed app claims on the link host (architecture §5.2).
 *
 * One list, read by three things that must agree: `app.config.ts` (Android
 * intent filters, iOS associated domains), the two well-known files the web
 * host serves (`apps/app/public/.well-known/`), and the router, whose routes
 * they are. `apps/app/src/data/links/appLinks.test.ts` fails if any of the
 * three drifts from this.
 *
 * `exact` is a path with nothing after it: the capability links (`/join`,
 * `/a`, `/e`, `/v`), whose payload is in the fragment and never in the path
 * (ADR 0023). `prefix` is a path followed by a short code (`/j/<code>`,
 * `/p/<code>` and the plan's own sub-pages), which is not a token (ADR 0022).
 *
 * Anything else on the host stays in the browser: `/get-the-app`, `/privacy`,
 * the link-preview route. An app that claimed the whole domain would swallow
 * the page that tells a person how to get it.
 */
export const APP_LINK_PATHS = [
  { path: '/join', match: 'exact' },
  { path: '/j/', match: 'prefix' },
  { path: '/p/', match: 'prefix' },
  { path: '/a', match: 'exact' },
  { path: '/e', match: 'exact' },
  { path: '/v', match: 'exact' },
] as const;

export type AppLinkPath = (typeof APP_LINK_PATHS)[number];
