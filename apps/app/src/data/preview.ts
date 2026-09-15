import { EN_PREVIEW_TEMPLATES, ogDescription, ogTitle } from '@circles/domain';

/**
 * What a chat shows when somebody pastes the link (architecture §9.4, §5.2).
 *
 * The route that serves this is the one server responsibility in the app
 * (ADR 0001); everything it decides is here, where it can be tested, and the
 * route itself is composition and a `fetch`.
 *
 * **The card carries the circle's name and nothing else.** Not because
 * something strips the rest, but because nothing else is ever in scope:
 * `ogTitle` takes a name, `ogDescription` takes nothing at all, and the
 * database function behind it returns one `text`. A preview is rendered to
 * everybody in the thread, including people who are not in the circle — and a
 * quiet ask exists precisely to keep "somebody wants to organise something"
 * out of that thread.
 */

/** A chat app fetching a card, rather than a person opening a link. */
const PREVIEW_AGENTS =
  /whatsapp|facebookexternalhit|facebookcatalog|twitterbot|slackbot|discordbot|telegrambot|linkedinbot|applebot|skypeuripreview|redditbot|embedly|pinterest|vkshare|bitlybot|flipboard|iframely|bingbot|quora link preview/i;

/** The three link shapes, and the one a preview can never resolve. */
export const PREVIEW_KINDS = new Set(['j', 'p', 'join']);

export function isPreviewAgent(userAgent: string | null): boolean {
  return userAgent !== null && PREVIEW_AGENTS.test(userAgent);
}

/**
 * HTML escaping, because a circle is named by a person and "1 to 40 characters"
 * is the only rule the column has. `Movie & "Chill"` has to render as itself,
 * and a name holding a quote must not be able to close the attribute it sits in.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The three paths a shared link can be, as a path rather than a route
 * parameter: `/join`, `/j/<code>` and `/p/<code>` (architecture §5). Anything
 * else is not a link anybody pasted and gets no card.
 */
export function previewTargetFor(pathname: string): { kind: string; code: string | null } | null {
  const [, first, second] = pathname.split('/');
  // `/join` and `/join/` are the same link; a chat client that tidies a URL
  // should not turn the card off.
  if (first === 'join' && (second === undefined || second === '')) {
    return { kind: 'join', code: null };
  }
  if ((first === 'j' || first === 'p') && second !== undefined && second !== '') {
    try {
      return { kind: first, code: decodeURIComponent(second) };
    } catch {
      // A stray `%` in a pasted link. Not a code, and not a 500 either.
      return null;
    }
  }
  return null;
}

/**
 * The card's headers, and the most important line in this file.
 *
 * **`no-store`, because the card is served at the app's own URL.** The
 * middleware answers `/j/<code>` for a chat app, and a person taps that same
 * URL a minute later. EAS Hosting caches a `public` response keyed on the URL
 * alone — `Vary: User-Agent` is not honoured — so one fetch by WhatsApp put
 * the card in front of every human who followed, and the card's own refresh
 * points at the URL it was served on, which is now the cached card. A loop,
 * for five minutes, on the link the whole product hangs off.
 *
 * `Vary` stays because it is true and costs nothing, but nothing may rely on
 * it. A fetcher asks once per paste and a name lookup is one indexed read;
 * there was never much to cache.
 */
export const CARD_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  // Nothing about where the link was opened from travels onward.
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  vary: 'User-Agent',
  'x-content-type-options': 'nosniff',
};

/**
 * The origin to build absolute URLs from. The configured one where there is
 * one, and the request's own otherwise — a redirect to a relative URL throws,
 * and a misconfigured deployment should still serve the app rather than a 500.
 */
export function originOf(url: URL): string {
  const configured = process.env.EXPO_PUBLIC_APP_ORIGIN;
  return configured !== undefined && configured !== '' ? configured : url.origin;
}

/** Where a person should end up: the client route this card is about. */
export function destinationFor(origin: string, kind: string, code: string | null): string {
  if (kind === 'join' || code === null) return `${origin}/join`;
  return `${origin}/${kind}/${encodeURIComponent(code)}`;
}

export interface Card {
  /** Null for a circle invite, an unknown code, or a database we could not reach. */
  circleName: string | null;
  target: string;
  imageUrl: string;
}

export function previewCard({ circleName, target, imageUrl }: Card): string {
  const title =
    circleName === null
      ? EN_PREVIEW_TEMPLATES.title('A circle')
      : ogTitle(circleName, EN_PREVIEW_TEMPLATES);
  const description = ogDescription(EN_PREVIEW_TEMPLATES);

  // The refresh carries anybody who lands here on to the real route. The script
  // runs first where there is one and takes the fragment with it, which is how
  // `/join#<secret>` survives a bounce through a page that never saw it — the
  // fragment is not sent to a server, so it cannot be in the HTML either.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
</head>
<body>
<p><a href="${escapeHtml(target)}">${escapeHtml(description)}</a></p>
<script>location.replace(${JSON.stringify(target)} + location.hash);</script>
</body>
</html>`;
}

/**
 * The circle's name behind a short code, or null for anything we will not or
 * cannot resolve.
 *
 * PostgREST directly rather than through a client library: this runs on a
 * server with no session, and the one thing it does is call a function granted
 * to `anon`. Every failure is a generic card and never an error page — a group
 * chat should not learn that our database is having a bad morning.
 */
export async function lookupCircleName(kind: string, code: string | null): Promise<string | null> {
  if (kind === 'join' || code === null) return null;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || key === undefined || url === '' || key === '') return null;

  try {
    const response = await fetch(`${url}/rest/v1/rpc/preview_for_code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_kind: kind, p_code: code }),
    });
    if (!response.ok) return null;
    const name: unknown = await response.json();
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
