/**
 * One-time: sign in as the Wenna TikTok account and print the refresh token
 * the publisher uses. The access token it trades for lasts a day; the
 * refresh token a year, and the publisher refreshes on every run.
 *
 *   npm run auth:tiktok
 *
 * Needs TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env, from a TikTok
 * developer app with Login Kit (Desktop) and the Content Posting API, scope
 * video.upload, and this redirect URI registered:
 *   http://127.0.0.1:3455/callback/   (or set TIKTOK_REDIRECT_PORT)
 */
import { randomBytes } from 'node:crypto';
import { tiktokToken } from './adapters.ts';
import { challengeHex, listen, need, verifier } from './loopback.ts';

const SCOPE = 'user.info.basic,video.upload';

async function main() {
  const clientKey = need('TIKTOK_CLIENT_KEY');
  need('TIKTOK_CLIENT_SECRET');
  const state = randomBytes(16).toString('hex');
  const v = verifier();
  const { redirectUri, code } = await listen(Number(process.env.TIKTOK_REDIRECT_PORT || 3455), '/callback/', state);

  const auth = new URL('https://www.tiktok.com/v2/auth/authorize/');
  auth.search = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge: challengeHex(v),
    code_challenge_method: 'S256',
  }).toString();
  console.log(`Open this, and sign in as the Wenna TikTok account:\n\n${auth}\n`);

  const tok = await tiktokToken({ code: await code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: v });
  if (!tok.scope.split(',').includes('video.upload')) {
    console.error(`signed in, but without video.upload (got "${tok.scope}"); approve that scope and run this again`);
    process.exit(1);
  }
  const days = Math.round(tok.refresh_expires_in / 86_400);
  console.log(`Put this in content/.env (and the repo's TIKTOK_REFRESH_TOKEN secret); it lasts ${days} days:\n\nTIKTOK_REFRESH_TOKEN=${tok.refresh_token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
