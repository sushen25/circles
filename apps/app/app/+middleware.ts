import {
  CARD_HEADERS,
  destinationFor,
  isPreviewAgent,
  lookupCircleName,
  originOf,
  previewCard,
  previewTargetFor,
} from '../src/data/preview';

/**
 * Link previews, on the paths people actually paste (architecture §9.4).
 *
 * The share messages link to `/join#…`, `/j/<code>` and `/p/<code>`, and those
 * are client pages. Expo Router will not let a page and an API route share a
 * path, so the card cannot live at `/j/[code]` — and a card served only at
 * `/og/...` is a card no chat app ever asks for. Middleware is the one place
 * that sees a request to a page before the page does.
 *
 * It answers **only** a preview fetcher, and only on those three paths.
 * Everything else falls through untouched, which is every request a person
 * makes: the user-agent test is routing, not authorisation, and the content it
 * guards is public by design.
 */
export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!isPreviewAgent(request.headers.get('user-agent'))) return undefined;

  const url = new URL(request.url);
  const preview = previewTargetFor(url.pathname);
  if (preview === null) return undefined;

  const origin = originOf(url);
  const { kind, code } = preview;
  const name = await lookupCircleName(kind, code);

  return new Response(
    previewCard({
      circleName: name,
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
    patterns: ['/join', '/join/', '/j/[code]', '/p/[code]'],
  },
};
