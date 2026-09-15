import {
  CARD_HEADERS,
  PREVIEW_KINDS,
  destinationFor,
  isPreviewAgent,
  lookupCircleName,
  originOf,
  previewCard,
} from '../../src/data/preview';

/**
 * The link-preview card, addressed directly (architecture §9.4, ADR 0001).
 *
 * `+middleware.ts` is what a chat app actually reaches, because the links
 * people paste are `/join`, `/j/<code>` and `/p/<code>` and those are client
 * pages. This route is the same card at an address of its own: somewhere to
 * point a fetcher that cannot be intercepted, and the thing to curl when asking
 * "what does the card say" without pretending to be WhatsApp.
 *
 * Route only — the card, the escaping, the user-agent test and the lookup are
 * in `src/data/preview.ts`, where they are tested.
 */
export async function GET(request: Request, params: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const origin = originOf(url);
  const kind = params['kind'] ?? '';
  const code = url.searchParams.get('c');

  if (!PREVIEW_KINDS.has(kind)) return Response.redirect(`${origin}/`, 302);

  const target = destinationFor(origin, kind, code);

  // A person wants the app, not a card — and the fragment survives a redirect,
  // because the browser reattaches it to the destination.
  if (!isPreviewAgent(request.headers.get('user-agent'))) return Response.redirect(target, 302);

  const name = await lookupCircleName(kind, code);

  return new Response(
    previewCard({ circleName: name, target, imageUrl: `${origin}/og-card.png` }),
    { status: 200, headers: { ...CARD_HEADERS } },
  );
}
