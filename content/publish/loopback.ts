/**
 * The local half of a one-time OAuth sign-in (npm run auth:youtube,
 * npm run auth:tiktok): listen on 127.0.0.1, print the consent URL, wait for
 * the browser to come back with ?code=, check `state`, and hand the code
 * over. Nothing is stored; the caller prints the refresh token for .env.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

/** A PKCE verifier: 64 unreserved characters. */
export const verifier = () => randomBytes(48).toString('base64url');

/** RFC 7636 S256, as Google wants it. */
export const challengeBase64url = (v: string) => createHash('sha256').update(v).digest('base64url');

/** TikTok's desktop flow wants the same SHA-256, hex-encoded (its docs say so). */
export const challengeHex = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Starts the listener on `port` (0 = any free port) and returns the
 * redirect URI it answers on and a promise of the code.
 */
export async function listen(port: number, path: string, state: string): Promise<{ redirectUri: string; code: Promise<string> }> {
  let resolveCode!: (c: string) => void;
  let rejectCode!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== path) {
      res.writeHead(404).end();
      return;
    }
    const err = url.searchParams.get('error');
    const got = url.searchParams.get('code');
    const ok = !err && got && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Signed in. You can close this tab and go back to the terminal.' : 'Sign-in failed; see the terminal.');
    server.close();
    if (ok) resolveCode(got);
    else rejectCode(new Error(err ? `${err}: ${url.searchParams.get('error_description') ?? ''}` : 'no code, or the state did not match'));
  });
  await new Promise<void>((res) => server.listen(port, '127.0.0.1', res));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  return { redirectUri: `http://127.0.0.1:${actual}${path}`, code };
}

export function need(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`missing env ${k}; put it in content/.env first (see .env.example)`);
    process.exit(2);
  }
  return v;
}
