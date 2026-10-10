import { fontAssets } from '@circles/tokens/font-assets';
import { Asset } from 'expo-asset';

import {
  CARD_HEADERS,
  destinationFor,
  isPreviewAgent,
  lookupPreview,
  originOf,
  previewCard,
  previewTargetFor,
} from '../src/data/preview';
import { SITE_HEADERS, sitePage } from '../src/features/site/page';
import { siteFontsFrom } from '../src/features/site/styles';

/**
 * The site's fonts are the app's: the URLs the bundler gave the WOFF2 files,
 * hash and all, which the app's own pages preload. A visitor who goes from `/`
 * to `/start` finds them in the browser's cache and downloads nothing twice
 * (SUS-174).
 */
const SITE_FONTS = siteFontsFrom((face) => Asset.fromModule(fontAssets[face]).uri);

/**
 * Link previews, on the paths people actually paste (architecture §9.4).
 *
 * The share messages link to `/join#…`, `/j/<code>` and `/p/<code>`, and those
 * are client pages. Expo Router will not let a page and an API route share a
 * path, so the card cannot live at `/j/[code]` — and a card served only at
 * `/og/...` is a card no chat app ever asks for. Middleware is the one place
 * that sees a request to a page before the page does.
 *
 * It answers **only** a preview fetcher, and only on those three paths —
 * apart from `/`, which it answers for everybody with the marketing site.
 * Everything else falls through untouched, which is every request a person
 * makes: the user-agent test is routing, not authorisation, and the content it
 * guards is public by design.
 */
export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  // The bare host is the marketing site, for everybody (ADR 0052). A document
  // request for `/` only: the app's own front door is `/start`, and a client
  // navigation to `/` inside the app never reaches the server.
  if (url.pathname === '/') {
    return new Response(request.method === 'HEAD' ? null : sitePage(originOf(url), SITE_FONTS), {
      status: 200,
      headers: { ...SITE_HEADERS },
    });
  }

  if (!isPreviewAgent(request.headers.get('user-agent'))) return undefined;

  const preview = previewTargetFor(url.pathname);
  if (preview === null) return undefined;

  const origin = originOf(url);
  const { kind, code } = preview;
  const found = await lookupPreview(kind, code);

  return new Response(
    previewCard({
      kind,
      ...found,
      target: destinationFor(origin, kind, code),
      imageUrl: `${origin}/og-card.png`,
    }),
    { status: 200, headers: { ...CARD_HEADERS } },
  );
}

/**
 * The paths this runs on, in the shape `expo-server` actually reads —
 * `{ methods, patterns }`. An array was accepted silently and matched nothing,
 * so the middleware ran on every request and only `previewTargetFor` kept it
 * from doing anything: a comment standing in for the enforcement beside it.
 */
export const unstable_settings = {
  // `/join/` is spelled out because a pattern with no `[param]` is compared as
  // an exact string — `/join` does not match `/join/`, while `/j/[code]` does
  // match a trailing slash. Without both, `previewTargetFor`'s trailing-slash
  // branch is code no request reaches.
  matcher: {
    methods: ['GET', 'HEAD'],
    patterns: ['/', '/join', '/join/', '/j/[code]', '/p/[code]'],
  },
};
