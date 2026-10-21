/**
 * Renew the Threads and Instagram long-lived tokens before they expire.
 *
 *   npm run refresh:tokens              # renew both, write them to .env
 *   npm run refresh:tokens -- --github  # and update the repo's secrets (gh CLI)
 *
 * Meta's long-lived tokens last 60 days and can be renewed once they are a
 * day old, for another 60. The publisher cannot save a renewed token back to
 * GitHub, so this runs here, about monthly; the publisher warns when one is
 * within 10 days of expiring (THREADS_TOKEN_EXPIRES, IG_TOKEN_EXPIRES).
 * A token from Facebook Login (not IGAA…) cannot be renewed this way.
 */
import { execFileSync } from 'node:child_process';
import { setEnvLine } from './envfile.ts';

const github = process.argv.includes('--github');
const day = (secs: number) => new Date(Date.now() + secs * 1000).toISOString().slice(0, 10);

type Renewed = { access_token: string; expires_in: number };

async function renew(name: string, tokenKey: string, expiresKey: string, url: string): Promise<boolean> {
  const token = process.env[tokenKey];
  if (!token) {
    console.log(`${name}: ${tokenKey} not set, skipped`);
    return true;
  }
  const res = await fetch(`${url}&access_token=${encodeURIComponent(token)}`);
  const body = (await res.json().catch(() => ({}))) as Partial<Renewed> & { error?: { message?: string } };
  if (!res.ok || !body.access_token) {
    console.error(`${name}: renewal failed: ${res.status} ${body.error?.message ?? ''}`);
    return false;
  }
  const until = day(body.expires_in ?? 60 * 86_400);
  setEnvLine(tokenKey, body.access_token);
  setEnvLine(expiresKey, until);
  if (github) {
    execFileSync('gh', ['secret', 'set', tokenKey], { input: body.access_token, stdio: ['pipe', 'inherit', 'inherit'] });
    execFileSync('gh', ['variable', 'set', expiresKey, '--body', until], { stdio: 'inherit' });
  }
  console.log(`${name}: renewed, valid until ${until}${github ? '; repo secret updated' : '; run with --github to update the repo secret'}`);
  return true;
}

const ok = [
  await renew('threads', 'THREADS_ACCESS_TOKEN', 'THREADS_TOKEN_EXPIRES', 'https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token'),
  (process.env.IG_ACCESS_TOKEN ?? '').startsWith('IG') || !process.env.IG_ACCESS_TOKEN
    ? await renew('instagram', 'IG_ACCESS_TOKEN', 'IG_TOKEN_EXPIRES', 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token')
    : (console.log('instagram: a Facebook Login token; renew it in the Meta dashboard'), true),
];
if (ok.includes(false)) process.exit(1);
