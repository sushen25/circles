/**
 * One-time: sign in as the Wenna YouTube channel and print the refresh token
 * the publisher uses.
 *
 *   npm run auth:youtube
 *
 * Needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env, from a Google
 * Cloud OAuth client of type "Desktop app" (loopback redirects on any port
 * are allowed for that type). The consent screen must be "In production":
 * in "Testing", Google expires the refresh token after 7 days.
 */
import { randomBytes } from 'node:crypto';
import { challengeBase64url, listen, need, verifier } from './loopback.ts';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

async function main() {
  const clientId = need('YOUTUBE_CLIENT_ID');
  const clientSecret = need('YOUTUBE_CLIENT_SECRET');
  const state = randomBytes(16).toString('hex');
  const v = verifier();
  const { redirectUri, code } = await listen(0, '/callback', state);

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challengeBase64url(v),
    code_challenge_method: 'S256',
  }).toString();
  console.log(`Open this, and sign in as the account that owns the Wenna channel:\n\n${auth}\n`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: await code,
      code_verifier: v,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tok = (await res.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.refresh_token) {
    console.error(`no refresh token: ${tok.error ?? res.status} ${tok.error_description ?? ''}`);
    process.exit(1);
  }
  console.log(`Put this in content/.env (and the repo's YOUTUBE_REFRESH_TOKEN secret):\n\nYOUTUBE_REFRESH_TOKEN=${tok.refresh_token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
