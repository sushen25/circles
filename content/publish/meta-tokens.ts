/**
 * Renewing a Meta long-lived token: the one place the Threads and Instagram
 * refresh is written, shared by `npm run refresh:tokens` (the monthly hand
 * run) and `npm run tokens` (the nightly report, which renews as a side
 * effect once a token is a day old).
 *
 * Meta's long-lived tokens last 60 days and can be renewed once they are
 * 24 hours old, for another 60. The token goes to the refresh endpoint as a
 * query parameter built with `withQuery`, never through a template string,
 * so no line printed here can carry it. The renewed token is written to
 * `.env` with `setEnvLine` and, with `github: true`, into the repository's
 * secrets with the gh CLI (the publisher runs in an Action that cannot
 * write its own secrets, so this runs on a laptop).
 */
import { execFileSync } from 'node:child_process';
import { redact, withQuery } from '../analytics/platforms/http.ts';
import { setEnvLine } from './envfile.ts';

export const META = {
  threads: {
    tokenKey: 'THREADS_ACCESS_TOKEN',
    expiresKey: 'THREADS_TOKEN_EXPIRES',
    url: 'https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token',
  },
  instagram: {
    tokenKey: 'IG_ACCESS_TOKEN',
    expiresKey: 'IG_TOKEN_EXPIRES',
    url: 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token',
  },
} as const;
export type MetaPlatform = keyof typeof META;

/** Days a renewed long-lived token lasts, when the platform does not say. */
export const META_TOKEN_DAYS = 60;

/**
 * An Instagram token from Instagram Login starts with `IG` and renews at
 * graph.instagram.com; one from Facebook Login does not and has to be
 * renewed in the Meta dashboard. An unset token is "renewable" here so that
 * `renew()` is the one that says "not set, skipped".
 */
export function canRenewInstagram(token: string | undefined): boolean {
  return !token || token.startsWith('IG');
}

export type RenewOptions = {
  /** also `gh secret set` the token and `gh variable set` the expiry date */
  github?: boolean;
  /** the .env to rewrite; the tests point it at a temp file */
  envPath?: string;
  /** runs gh; the tests swap it so nothing is executed */
  exec?: (cmd: string, args: string[], input?: string) => void;
  /** the clock, for the expiry date */
  now?: () => Date;
};

/** `until` is set only when a token was renewed; a token that is not set is ok and skipped. */
export type Renewal = { ok: boolean; until?: string };

type Renewed = { access_token?: string; expires_in?: number; error?: { message?: string } };

const runGh = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, input === undefined ? { stdio: 'inherit' } : { input, stdio: ['pipe', 'inherit', 'inherit'] });

/**
 * Renew one platform's token. Prints one line per outcome, never the token.
 * Returns ok: false only when the platform refused; a token that is not set
 * is skipped and ok.
 */
export async function renew(platform: MetaPlatform, opts: RenewOptions = {}): Promise<Renewal> {
  const { tokenKey, expiresKey, url } = META[platform];
  const token = process.env[tokenKey];
  if (!token) {
    console.log(`${platform}: ${tokenKey} not set, skipped`);
    return { ok: true };
  }
  const res = await fetch(withQuery(url, { access_token: token }));
  const body = (await res.json().catch(() => ({}))) as Renewed;
  if (!res.ok || !body.access_token) {
    // Meta writes the token into its own message ("Error validating access token: <token> has expired"): blank it, then redact the rest.
    const reason = redact((body.error?.message ?? '').replaceAll(token, '…'));
    console.error(`${platform}: renewal failed: ${res.status} ${reason}`);
    return { ok: false };
  }
  const now = (opts.now ?? (() => new Date()))();
  const until = new Date(now.getTime() + (body.expires_in ?? META_TOKEN_DAYS * 86_400) * 1000).toISOString().slice(0, 10);
  const wrote = setEnvLine(tokenKey, body.access_token, opts.envPath) && setEnvLine(expiresKey, until, opts.envPath);
  if (opts.github) {
    const exec = opts.exec ?? runGh;
    exec('gh', ['secret', 'set', tokenKey], body.access_token);
    exec('gh', ['variable', 'set', expiresKey, '--body', until]);
  } else if (!wrote) {
    // Without a .env and without --github the new token has nowhere to go; the old one still works until it expires.
    console.warn(`${platform}: no .env here, so the renewed token was not saved; run again with --github, or from a machine with a .env`);
  }
  console.log(`${platform}: renewed, valid until ${until}${opts.github ? '; repo secret updated' : '; run with --github to update the repo secret'}`);
  return { ok: true, until };
}
