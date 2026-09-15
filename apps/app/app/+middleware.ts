import {
  PREVIEW_KINDS,
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
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        // A shared cache must not hand a person the card instead of the app.
        vary: 'User-Agent',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

/** Only the three paths a link can be. `PREVIEW_KINDS` is the same list. */
export const unstable_settings = { matcher: [...PREVIEW_KINDS] };
