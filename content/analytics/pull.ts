/**
 * The nightly pull: one row per published post per platform into
 * analytics/posts.jsonl, the account's own numbers for the day before into
 * account.jsonl (the row's `date` is that day; `at` is the pull time), new
 * replies into inbox/, and a claim for any hand post whose tag turns up in
 * the account's recent uploads. A small orchestrator over one module per
 * platform in analytics/platforms/, the way publish/publish.ts is a loop
 * over publish/adapters.ts: the modules talk to the platforms, this file
 * decides what to ask for and where it goes (docs/analytics-plan.md,
 * "Pull" and "Data model").
 *
 *   npm run analytics                    # the nightly run
 *   npm run analytics -- --series        # every two hours: posts under 48 hours old, into series.jsonl
 *   npm run analytics -- --only youtube  # one platform; the rest are left alone
 *   npm run analytics -- --only wenna    # only the funnel by tag; add --dry to print it and write nothing
 *   npm run analytics -- --dry           # make the calls, write nothing, say what would be written
 *   npm run analytics -- --no-replies --no-account --no-claim
 *
 * A platform with no module or no token is skipped and says so, once. So is
 * a call a module declines because asking again would change nothing
 * (module.ts: Unreadable, a private Short read with an API key alone;
 * NotConfigured, an account or recent call that needs a setting the module
 * does not require): a `skip` line, never a `FAIL`, outside the tally. A
 * platform that fails on every post it had, or a Meta token inside seven
 * days of expiry, makes the exit code 1 after everything has been written,
 * so the Action still commits what it got and somebody notices. Nothing
 * here posts, edits or deletes on any platform: every call is a read.
 * TikTok has no module yet; its numbers arrive by `npm run hand -- …`.
 * The nightly run also appends a features.jsonl row for any published piece
 * whose measure is new or changed (analytics/features.ts); that reads files
 * only. Once a night it also asks Wenna for the funnel by tag (platforms/wenna.ts,
 * ADR 0087) when WENNA_FUNNEL_URL and CONTENT_FUNNEL_SECRET are both set, and appends
 * counts to funnel.jsonl; with either unset it says "not configured" and goes on.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listQueue, type Platform, type QueueItem } from '../lib/queue.ts';
import { PLATFORM_PREFIX, sourceRef } from '../lib/links.ts';
import { readLedger, type Ledger } from '../publish/guards.ts';
import { META, type MetaPlatform } from '../publish/meta-tokens.ts';
import {
  SERIES_HOURS,
  ageDays,
  ageHours,
  appendJsonl,
  dateOf,
  daysUntil,
  expiring,
  readJsonl,
  type AccountRow,
  type PostRow,
  type SeriesRow,
} from './metrics.ts';
import { NotConfigured, Unreadable, env as realEnv, type PlatformModule, type RecentPost } from './platforms/module.ts';
import { configured as wennaConfigured, fetchFunnel, rowsOf } from './platforms/wenna.ts';
import { claim } from './claim.ts';
import { writeReplies, type ReplyEntry } from './inbox.ts';
import { writeFeatures } from './features.ts';

export type Flags = {
  /** the two-hourly run: posts under SERIES_HOURS old, into series.jsonl, nothing else */
  series: boolean;
  /** one platform, or `wenna`: only the funnel by tag */
  only?: Platform | 'wenna';
  /** make the calls, write nothing */
  dry: boolean;
  replies: boolean;
  account: boolean;
  claim: boolean;
};

export type Dirs = {
  queue: string;
  published: string;
  /** the ledger file */
  ledger: string;
  /** where posts.jsonl, series.jsonl, account.jsonl and replies-seen.json live */
  analytics: string;
  inbox: string;
};

export type Summary = {
  rows: number;
  seriesRows: number;
  accountRows: number;
  repliesWritten: number;
  claims: number;
  failures: number;
  exitCode: number;
};

export const DEFAULT_DIRS: Dirs = {
  queue: 'queue',
  published: 'published',
  ledger: 'publish/ledger.jsonl',
  analytics: 'analytics',
  inbox: 'inbox',
};

/** How the Meta platforms are named in the expiry lines; their token and expiry keys are publish/meta-tokens.ts's META. */
const META_NAMES: Record<MetaPlatform, string> = { instagram: 'Instagram', threads: 'Threads' };

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { series: false, dry: false, replies: true, account: true, claim: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--series':
        flags.series = true;
        break;
      case '--dry':
        flags.dry = true;
        break;
      case '--no-replies':
        flags.replies = false;
        break;
      case '--no-account':
        flags.account = false;
        break;
      case '--no-claim':
        flags.claim = false;
        break;
      case '--only': {
        const p = argv[++i];
        if (!p || !(p === 'wenna' || p in PLATFORM_PREFIX)) throw new Error('--only needs a platform, e.g. --only youtube, or wenna');
        flags.only = p as Platform | 'wenna';
        // The funnel is not a platform: nothing else is asked, so nothing else is read or written.
        if (p === 'wenna') Object.assign(flags, { replies: false, account: false, claim: false });
        break;
      }
      default:
        throw new Error(`unknown flag ${a}; see the header of analytics/pull.ts`);
    }
  }
  return flags;
}

type Post = { item: QueueItem; platform: Platform; id: string; posted_at: string };

/**
 * The ledger's `at` (the real, jittered time), else the item's publish_at, else its date at midnight UTC. A TikTok
 * draft the founder then posted has two rows, "drafted" and "posted" (claim.ts); the posted one is the time it went out.
 */
function postedAt(item: QueueItem, platform: Platform, ledger: Ledger): string {
  const rows = ledger.filter((r) => r.slug === item.fm.slug && r.platform === platform);
  const row = rows.find((r) => r.kind !== 'drafted') ?? rows[0];
  for (const candidate of [row?.at, item.fm.publish_at, `${item.fm.date}T00:00:00Z`]) {
    if (candidate && !Number.isNaN(Date.parse(candidate))) return new Date(candidate).toISOString();
  }
  throw new Error(`${item.fm.slug}: no usable publish time for ${platform}`);
}

const fmtMetrics = (m: Record<string, number | undefined>) =>
  Object.entries(m)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${v}`)
    .join(' ');

/** `from=<tag>` in a caption or description, not followed by more slug characters, so `yt-only-moves` never claims `yt-only-moves-again`. */
export function carriesTag(text: string, tag: string): boolean {
  const i = text.indexOf(`from=${tag}`);
  if (i < 0) return false;
  const next = text[i + `from=${tag}`.length];
  return next === undefined || !/[a-z0-9-]/.test(next);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A module saying it cannot, and that asking again would change nothing (module.ts): a skip line, outside the tally and the failure count. */
const skippable = (e: unknown): boolean => e instanceof Unreadable || e instanceof NotConfigured;

export async function runPull(opts: {
  now: Date;
  flags: Flags;
  dirs: Dirs;
  modules: Partial<Record<Platform, PlatformModule>>;
  log?: (line: string) => void;
  /** one env var, trimmed, undefined when unset or blank; the tests hand in values instead of touching process.env */
  env?: (k: string) => string | undefined;
  /** the Wenna funnel call's fetch; the tests hand in their own */
  fetch?: typeof fetch;
}): Promise<Summary> {
  const { now, flags, dirs, modules } = opts;
  const log = opts.log ?? console.log;
  const env = opts.env ?? realEnv;
  const date = dateOf(now);
  const at = now.toISOString();
  // The account rows describe the UTC day before the pull, the last whole one the platforms can report on.
  const accountDay = dateOf(new Date(now.getTime() - 86_400_000));
  const summary: Summary = { rows: 0, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 };
  const paths = {
    posts: join(dirs.analytics, 'posts.jsonl'),
    series: join(dirs.analytics, 'series.jsonl'),
    account: join(dirs.analytics, 'account.jsonl'),
    seen: join(dirs.analytics, 'replies-seen.json'),
    features: join(dirs.analytics, 'features.jsonl'),
    funnel: join(dirs.analytics, 'funnel.jsonl'),
  };

  const write = (path: string, row: unknown, what: string) => {
    if (flags.dry) log(`dry   would append ${what} to ${path}`);
    else appendJsonl(path, row);
  };

  let ledger = readLedger(dirs.ledger);
  const items = [dirs.queue, dirs.published].filter((d) => existsSync(d)).flatMap((d) => listQueue(d));

  // A module is looked up and asked configured() once per run; the answer, and the one skip line, are kept here.
  const usable = new Map<Platform, PlatformModule | undefined>();
  const moduleFor = (platform: Platform): PlatformModule | undefined => {
    if (flags.only && platform !== flags.only) return undefined;
    if (usable.has(platform)) return usable.get(platform);
    const m = modules[platform];
    let use: PlatformModule | undefined;
    if (!m) log(`skip  ${platform}: no module yet`);
    else {
      const c = m.configured();
      if (c.ok) use = m;
      else log(`skip  ${platform}: not configured (${c.reason})`);
    }
    usable.set(platform, use);
    return use;
  };

  const posts = (): Post[] =>
    items.flatMap((item) =>
      Object.entries(item.fm.published ?? {}).map(([platform, id]) => ({
        item,
        platform: platform as Platform,
        id,
        posted_at: postedAt(item, platform as Platform, ledger),
      })),
    );

  // Tier 1: the post's numbers. A failure is printed and the other posts continue; the tally decides the exit code.
  const tally = new Map<Platform, { ok: number; failed: number }>();
  async function fetchRow(m: PlatformModule, p: Post): Promise<PostRow | undefined> {
    const t = tally.get(p.platform) ?? { ok: 0, failed: 0 };
    tally.set(p.platform, t);
    try {
      const f = await m.metrics(p.id);
      t.ok++;
      return {
        date,
        at,
        slug: p.item.fm.slug,
        family: p.item.fm.family,
        platform: p.platform,
        id: p.id,
        from: sourceRef(p.platform, p.item.fm.slug),
        posted_at: p.posted_at,
        age_days: ageDays(p.posted_at, now),
        metrics: f.metrics,
        raw: f.raw,
      };
    } catch (e) {
      if (skippable(e)) {
        log(`skip  ${p.item.fm.slug} ${p.platform}: ${message(e)}`);
        return undefined;
      }
      t.failed++;
      summary.failures++;
      log(`FAIL  ${p.item.fm.slug} ${p.platform}: ${message(e)}`);
      return undefined;
    }
  }

  // An account or recent call a module declines is one skip line per platform and reason per run.
  const skipped = new Set<string>();
  const skipOnce = (line: string) => {
    if (skipped.has(line)) return;
    skipped.add(line);
    log(`skip  ${line}`);
  };

  const finish = (): Summary => {
    for (const [platform, t] of tally) {
      if (t.ok === 0 && t.failed > 0) {
        summary.exitCode = 1;
        log(`FAIL  ${platform}: failed on every post it had`);
      }
    }
    // A Meta expiry is checked only beside its token: an unset token is a platform that is off, not one expiring. A token
    // whose expiry was never recorded gets a note, because `npm run tokens -- --github` is what records it.
    if (!flags.series) {
      for (const platform of Object.keys(META) as MetaPlatform[]) {
        if (flags.only && platform !== flags.only) continue;
        const { tokenKey, expiresKey } = META[platform];
        const name = META_NAMES[platform];
        if (!env(tokenKey)) continue;
        const value = env(expiresKey);
        if (!value) {
          log(`note  ${name} token: ${expiresKey} unset; run npm run tokens -- --github`);
          continue;
        }
        const days = daysUntil(value, now);
        if (Number.isNaN(days)) {
          log(`EXPIRING ${name} token: ${expiresKey} is not a date (${value}); run npm run tokens`);
          summary.exitCode = 1;
        } else if (expiring(days)) {
          log(`EXPIRING ${name} token: ${days} days (${value}); run npm run tokens`);
          summary.exitCode = 1;
        }
      }
    }
    log(
      `done  rows ${summary.rows}, series ${summary.seriesRows}, account ${summary.accountRows}, replies ${summary.repliesWritten}, claims ${summary.claims}, failures ${summary.failures}` +
        (flags.dry ? ' (dry run, nothing written)' : '') +
        (summary.exitCode ? '; exit 1' : ''),
    );
    return summary;
  };

  // Tier 3 by polling: the views-over-time curve, every two hours while a post is young.
  if (flags.series) {
    const young = posts().filter((p) => ageHours(p.posted_at, now) < SERIES_HOURS);
    if (!young.length) {
      log(`nothing under ${SERIES_HOURS} hours`);
      return summary;
    }
    for (const p of young) {
      const m = moduleFor(p.platform);
      if (!m) continue;
      const row = await fetchRow(m, p);
      if (!row) continue;
      const srow: SeriesRow = { ...row, age_hours: ageHours(p.posted_at, now) };
      write(paths.series, srow, `series row ${row.slug} ${row.platform}`);
      summary.seriesRows++;
      log(`row   ${row.slug} ${row.platform} age ${srow.age_hours}h ${fmtMetrics(row.metrics)}`);
    }
    return finish();
  }

  // Auto-claim first, so a hand post found tonight gets tonight's row.
  if (flags.claim) {
    const recentCache = new Map<Platform, RecentPost[]>();
    const recentFor = async (m: PlatformModule): Promise<RecentPost[]> => {
      let list = recentCache.get(m.platform);
      if (!list) {
        try {
          list = await m.recent!();
        } catch (e) {
          if (skippable(e)) skipOnce(`${m.platform}: ${message(e)}`);
          else {
            summary.failures++;
            log(`FAIL  recent ${m.platform}: ${message(e)}`);
          }
          list = [];
        }
        recentCache.set(m.platform, list);
      }
      return list;
    };
    let claimed = false;
    for (const item of items) {
      if (item.fm.status !== 'approved' && item.fm.status !== 'published') continue;
      for (const platform of item.fm.platforms) {
        if (item.fm.published?.[platform]) continue;
        const m = moduleFor(platform);
        if (!m?.recent) continue;
        const tag = sourceRef(platform, item.fm.slug);
        const hit = (await recentFor(m)).find((p) => carriesTag(p.text, tag));
        if (!hit) continue;
        if (flags.dry) {
          log(`dry   would claim ${item.fm.slug} → ${platform}: ${hit.id} (posted ${hit.at})`);
          summary.claims++;
          continue;
        }
        try {
          const r = claim(item, platform, hit.id, hit.at, { ledgerPath: dirs.ledger, publishedDir: dirs.published });
          claimed = true;
          summary.claims++;
          log(`claim ${item.fm.slug} → ${platform}: ${hit.id}${r.moved ? ` (moved to ${dirs.published}/)` : ''}`);
        } catch (e) {
          summary.failures++;
          log(`FAIL  claim ${item.fm.slug} → ${platform}: ${message(e)}`);
        }
      }
    }
    if (claimed) ledger = readLedger(dirs.ledger);
  }

  // What each published piece is (features.jsonl), from the files alone: no platform is asked, so --only leaves it out.
  if (!flags.only) {
    const f = writeFeatures({ items, ledger, path: paths.features, now, dry: flags.dry, log });
    summary.failures += f.failures;
  }

  // Tier 1 rows, and the replies on each post.
  const entries: ReplyEntry[] = [];
  for (const p of posts()) {
    const m = moduleFor(p.platform);
    if (!m) continue;
    const row = await fetchRow(m, p);
    if (!row) continue;
    write(paths.posts, row, `row ${row.slug} ${row.platform}`);
    summary.rows++;
    log(`row   ${row.slug} ${row.platform} age ${row.age_days}d ${fmtMetrics(row.metrics)}`);
    if (flags.replies) {
      try {
        const replies = await m.replies(p.id);
        if (replies.length) entries.push({ slug: row.slug, platform: p.platform, replies });
      } catch (e) {
        if (skippable(e)) log(`skip  ${row.slug} ${p.platform}: ${message(e)}`);
        else {
          summary.failures++;
          log(`FAIL  ${row.slug} ${p.platform} replies: ${message(e)}`);
        }
      }
    }
  }

  // Tier 2: the account itself, one row per platform per day. The day asked for, written as the row's `date` and compared
  // with the rows already there, is yesterday (UTC), not the pull's own date: the nightly job runs at 16:15 UTC, so
  // today's Instagram and YouTube day numbers would be partial. A module that reads the account as it stands (Bluesky,
  // the YouTube channel totals) answers with its own day instead; the row is stamped with that, and the check for a row
  // already there runs again against it, after the call, which is cheap for such a module. `at` is still the pull time.
  if (flags.account) {
    const have = readJsonl<AccountRow>(paths.account);
    for (const platform of Object.keys(modules) as Platform[]) {
      const m = moduleFor(platform);
      if (!m?.account) continue;
      if (have.some((r) => r.date === accountDay && r.platform === platform)) {
        log(`acct  ${platform}: already have ${accountDay}`);
        continue;
      }
      try {
        const a = await m.account(accountDay);
        const day = a.day ?? accountDay;
        if (day !== accountDay && have.some((r) => r.date === day && r.platform === platform)) {
          log(`acct  ${platform}: already have ${day}`);
          continue;
        }
        // Every call refused (a placeholder token, a revoked permission) leaves no number at all; a row
        // of nothing but errors would be written every night and read as a day with nothing in it.
        if (!Object.keys(a.metrics).length && !Object.keys(a.breakdowns).length) {
          const errors = (a.raw as { errors?: Record<string, string> } | undefined)?.errors;
          const first = errors && Object.values(errors)[0];
          summary.failures++;
          log(`FAIL  account ${platform}: nothing readable${first ? ` (${first})` : ''}`);
          continue;
        }
        const row: AccountRow = { date: day, at, platform, metrics: a.metrics, breakdowns: a.breakdowns, raw: a.raw };
        write(paths.account, row, `account row ${platform}`);
        summary.accountRows++;
        log(`acct  ${platform}: ${Object.keys(a.metrics).length} metrics, ${Object.keys(a.breakdowns).length} breakdowns${day !== accountDay ? ` for ${day}` : ''}`);
      } catch (e) {
        if (skippable(e)) skipOnce(`${platform}: ${message(e)}`);
        else {
          summary.failures++;
          log(`FAIL  account ${platform}: ${message(e)}`);
        }
      }
    }
  }

  // Tier 4: what Wenna saw after the tap, by tag. Not a platform, so a platform's --only leaves it out, and a failure is
  // counted like a platform's. Counts only come back (ADR 0087); they are written as returned.
  if (!flags.only || flags.only === 'wenna') {
    const w = wennaConfigured(env);
    if (!w.ok) log(`skip  wenna: not configured (${w.reason})`);
    else if (readJsonl<{ date: string }>(paths.funnel).some((r) => r.date === date)) log(`funnel already have ${date}`);
    else {
      // Counted from the first post: the export reads from the Monday of this day's week, and a tag is only ever on a post.
      const first = posts().map((p) => p.posted_at).sort()[0];
      const since = first ? dateOf(new Date(first)) : date;
      try {
        const rows = rowsOf(await fetchFunnel({ url: w.url, secret: w.secret, since, ...(opts.fetch ? { fetch: opts.fetch } : {}) }), date, at);
        for (const r of rows.tags) {
          write(paths.funnel, r, `funnel row ${r.from}`);
          log(`funnel ${r.from}: circles ${r.circles}, plans shared ${r.plans_shared}, answered ${r.answered}, confirmed ${r.confirmed}`);
        }
        write(paths.funnel, rows.stalled, 'funnel stalled row');
        log(`funnel stalled first plans from content: ${rows.stalled.stalled.reduce((n, g) => n + g.circles, 0)}`);
      } catch (e) {
        summary.failures++;
        log(`FAIL  funnel: ${message(e)}`);
        summary.exitCode = 1;
      }
    }
  }

  if (flags.replies) {
    const fetched = entries.reduce((n, e) => n + e.replies.length, 0);
    const file = join(dirs.inbox, `${date}-replies.md`);
    if (flags.dry) log(`dry   ${fetched} replies fetched; the unseen ones would go to ${file}`);
    else if (!fetched) log('inbox nothing new');
    else {
      const r = writeReplies(date, entries, { seenPath: paths.seen, inboxDir: dirs.inbox });
      summary.repliesWritten = r.written;
      log(r.written ? `inbox ${r.written} new ${r.written === 1 ? 'reply' : 'replies'} → ${r.file}` : 'inbox nothing new');
    }
  }

  return finish();
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  // Loaded here, not at the top, so a test can drive runPull with its own modules and nothing reads process.env on import.
  const { modules } = await import('./platforms/index.ts');
  const summary = await runPull({ now: new Date(), flags, dirs: DEFAULT_DIRS, modules });
  process.exitCode = summary.exitCode;
}

// import.meta.main is Node 24 only; CI runs Node 22.
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
