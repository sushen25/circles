/**
 * Every token's state on one screen, and the Meta renewals done while
 * looking (docs/analytics-plan.md, "Pull", Tokens).
 *
 *   npm run tokens                 # report; renew Threads and Instagram when they are a day old
 *   npm run tokens -- --github     # and write the renewed token into the repo's secrets (gh CLI)
 *   npm run tokens -- --no-refresh # report only
 *
 * Each platform module says what its credentials can do and when they
 * expire (`token()`), and promises that the answer carries no secret, so
 * every line here is printable; nothing else is read from the environment
 * for printing. Threads and Instagram tokens last 60 days and Meta renews
 * one once it is 24 hours old, so a token whose expiry is unset or whose
 * issue date (expiry minus 60 days) is more than a day back is renewed
 * here, through publish/meta-tokens.ts. The Action cannot write its own
 * secrets, and a token that could would be a bigger secret than the one it
 * refreshes, so without --github the two `gh` lines to run are printed
 * instead, reading the new token from .env rather than from this output.
 *
 * Exit 1 when any configured token is refused or is inside TOKEN_WARN_DAYS
 * of expiry, so a nightly run fails where somebody sees it.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from '../lib/queue.ts';
import { META, META_TOKEN_DAYS, canRenewInstagram, renew as realRenew, type MetaPlatform, type Renewal } from '../publish/meta-tokens.ts';
import { TOKEN_WARN_DAYS, daysUntil } from './metrics.ts';
import { redact } from './platforms/http.ts';
import { env as realEnv, type PlatformModule, type TokenState } from './platforms/module.ts';

export const USAGE = `usage: npm run tokens [--github] [--no-refresh]

  --github      after renewing a Meta token, gh secret set / gh variable set it (needs the gh CLI, signed in)
  --no-refresh  report only; renew nothing`;

export type Deps = {
  modules: Partial<Record<Platform, PlatformModule>>;
  renew: (platform: MetaPlatform, opts: { github?: boolean }) => Promise<Renewal>;
  env: (key: string) => string | undefined;
  /** whether a .env is here for the renewed token to land in; false in the Action */
  envFile: () => boolean;
  now: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
};

async function withDefaults(deps: Partial<Deps>): Promise<Deps> {
  const modules = deps.modules ?? (await import('./platforms/index.ts')).modules;
  return {
    renew: realRenew,
    env: realEnv,
    envFile: () => existsSync('.env'),
    now: () => new Date(),
    log: console.log,
    error: console.error,
    ...deps,
    modules,
  };
}

/**
 * Meta renews a long-lived token once it is 24 hours old. Only the expiry
 * date is recorded, so the issue date is taken as expiry minus 60 days; an
 * unset or unreadable expiry is renewed, which also records the date.
 */
export function shouldRenew(expires: string | undefined, now: Date): boolean {
  if (!expires) return true;
  const until = Date.parse(expires);
  if (Number.isNaN(until)) return true;
  const issued = until - META_TOKEN_DAYS * 86_400_000;
  return now.getTime() - issued > 86_400_000;
}

/** One line per platform: configured or not, the note, the expiry and days left, the scopes. */
export function formatToken(state: TokenState, now: Date): string {
  const parts = [state.configured ? 'configured' : 'not configured'];
  if (state.note) parts.push(state.note);
  if (state.expires) {
    const days = state.daysLeft ?? daysUntil(state.expires, now);
    parts.push(`expires ${state.expires} (${days < 0 ? `expired ${-days} days ago` : `${days} days left`})`);
  }
  if (state.scopes?.length) parts.push(`scopes ${state.scopes.join(' ')}`);
  return `${state.platform}: ${parts.join('; ')}`;
}

/** The two commands that put a renewed token into the repository, reading it from .env so it is never on screen. */
export function ghLines(platform: MetaPlatform, until: string): string[] {
  const { tokenKey, expiresKey } = META[platform];
  return [`grep '^${tokenKey}=' .env | cut -d= -f2- | gh secret set ${tokenKey}`, `gh variable set ${expiresKey} --body ${until}`];
}

/** Exit code: 0 every configured token is fine, 1 one is refused or expiring, 2 a wrong call. */
export async function run(argv: string[], deps: Partial<Deps> = {}): Promise<number> {
  const d = await withDefaults(deps);
  const unknown = argv.filter((a) => !['--github', '--no-refresh'].includes(a));
  if (unknown.length) {
    d.error(`unknown argument ${unknown.join(' ')}\n\n${USAGE}`);
    return 2;
  }
  const github = argv.includes('--github');
  // A renewed token needs a .env or the repo's secrets to land in; with neither (the Action), report only.
  const refresh = !argv.includes('--no-refresh') && (github || d.envFile());
  const now = d.now();
  let failed = false;

  // The report: what each module says about its credentials.
  const states: TokenState[] = [];
  for (const m of Object.values(d.modules)) {
    if (!m?.token) continue;
    try {
      const state = await m.token();
      states.push(state);
      d.log(formatToken(state, now));
    } catch (e) {
      failed = true;
      d.error(`${m.platform}: refused: ${redact((e as Error).message)}`);
    }
  }

  // The Meta renewals, and the expiry each platform ends the run with.
  const expiry: Partial<Record<MetaPlatform, string>> = {};
  for (const platform of Object.keys(META) as MetaPlatform[]) {
    const { tokenKey, expiresKey } = META[platform];
    if (!d.env(tokenKey)) continue;
    const expires = d.env(expiresKey);
    if (expires) expiry[platform] = expires;
    if (!refresh) {
      if (!expires) d.log(`${platform}: ${expiresKey} unset, so the expiry is unknown; a run that renews records it`);
      else if (shouldRenew(expires, now) && !argv.includes('--no-refresh')) d.log(`${platform}: a day old and renewable, but there is no .env here and no --github to save the new token into`);
      continue;
    }
    if (platform === 'instagram' && !canRenewInstagram(d.env(tokenKey))) {
      d.log('instagram: a Facebook Login token; renew it in the Meta dashboard');
      continue;
    }
    if (!shouldRenew(expires, now)) {
      d.log(`${platform}: issued under a day ago (expires ${expires}); Meta renews a token once it is 24 hours old`);
      continue;
    }
    const r = await d.renew(platform, { github });
    if (!r.ok) {
      failed = true;
      continue;
    }
    if (r.until) {
      expiry[platform] = r.until;
      if (!github) {
        d.log(`${platform}: put the renewed token into the repository with`);
        for (const line of ghLines(platform, r.until)) d.log(`      ${line}`);
      }
    }
  }

  // Loud when expiring: a Meta date from .env (renewed or not), or any date a module reported.
  const checked = new Set<string>();
  const warn = (platform: string, expires: string) => {
    if (checked.has(platform)) return;
    checked.add(platform);
    const days = daysUntil(expires, now);
    if (days < TOKEN_WARN_DAYS) {
      failed = true;
      d.error(`${platform}: token ${days < 0 ? 'expired' : `expires in ${days} days`} (${expires}); renew it now`);
    }
  };
  for (const [platform, expires] of Object.entries(expiry)) warn(platform, expires);
  for (const s of states) if (s.configured && s.expires && !(s.platform in expiry)) warn(s.platform, s.expires);

  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
