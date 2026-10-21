/**
 * One access token from the YouTube refresh token, for the publisher's
 * upload and the analytics pull's reads alike. It lives apart from
 * adapters.ts so that analytics/platforms/youtube.ts can import it without
 * pulling the whole publisher (and its @atproto types) into its typecheck.
 *
 * The scopes the refresh token carries decide what the pull can read:
 * `youtube.upload` alone posts a Short and reads nothing; `youtube.readonly`
 * reads the channel; `yt-analytics.readonly` reads retention and traffic.
 * `youtubeScopes()` asks Google which it has, so `npm run tokens` can say.
 */

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

export async function youtubeAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env('YOUTUBE_CLIENT_ID'),
      client_secret: env('YOUTUBE_CLIENT_SECRET'),
      refresh_token: env('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube token: ${res.status} ${text.replace(/"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]+"/g, '"$1":"…"').slice(0, 300)}`);
  const tok = JSON.parse(text) as { access_token?: string };
  if (!tok.access_token) throw new Error('YouTube token: no access_token in the answer');
  return tok.access_token;
}

/** The OAuth scopes an access token carries, from Google's tokeninfo endpoint. */
export async function youtubeScopes(accessToken: string): Promise<string[]> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new Error(`YouTube tokeninfo: ${res.status}`);
  const info = (await res.json()) as { scope?: string };
  return (info.scope ?? '').split(/\s+/).filter(Boolean);
}
