import { PREVIEW_KINDS, destinationFor, isPreviewAgent, previewCard } from '../../src/data/preview';

/**
 * The one server route in the app (ADR 0001, architecture §9.4).
 *
 * Route only — the card, the escaping and the user-agent test are in
 * `src/data/preview.ts`, where they are tested. What is here is the fetch and
 * the two answers: a card for a chat app, a redirect for a person.
 *
 * **The invite secret cannot reach this route.** `/join#<secret>` carries it in
 * the fragment, which a browser never sends to a server — so this could not
 * resolve a circle invite even if it wanted to, and `preview_for_code` refuses
 * that kind outright. What it can resolve is a plan short code, which carries
 * no secret and is in the path anyway.
 */

function origin(): string {
  return process.env.EXPO_PUBLIC_APP_ORIGIN ?? '';
}

/**
 * The circle's name, or null for anything we will not or cannot resolve.
 *
 * PostgREST directly rather than through a client library: this runs on a
 * server with no session, and the one thing it does is call a function granted
 * to `anon`. Every failure is a generic card and never an error page — a group
 * chat should not learn that our database is having a bad morning.
 */
async function circleName(kind: string, code: string): Promise<string | null> {
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

export async function GET(request: Request, params: Record<string, string>): Promise<Response> {
  const kind = params['kind'] ?? '';
  const code = new URL(request.url).searchParams.get('c');
  const target = destinationFor(origin(), kind, code);

  if (!PREVIEW_KINDS.has(kind)) return Response.redirect(`${origin()}/`, 302);

  // A person wants the app, not a card — and the fragment survives a redirect,
  // because the browser reattaches it to the destination.
  if (!isPreviewAgent(request.headers.get('user-agent'))) return Response.redirect(target, 302);

  const name = kind === 'join' || code === null ? null : await circleName(kind, code);

  return new Response(
    previewCard({ circleName: name, target, imageUrl: `${origin()}/og-card.png` }),
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Nothing about where the link was opened from travels onward.
        'referrer-policy': 'no-referrer',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}
