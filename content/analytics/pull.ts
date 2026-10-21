/**
 * The nightly pull: one row per published post per platform into
 * analytics/posts.jsonl, the account's own numbers into account.jsonl, new
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
 *   npm run analytics -- --dry           # make the calls, write nothing, say what would be written
 *   npm run analytics -- --no-replies --no-account --no-claim
 *
 * A platform with no module or no token is skipped and says so, once. A
 * platform that fails on every post it had, or a Meta token inside seven
 * days of expiry, makes the exit code 1 after everything has been written,
 * so the Action still commits what it got and somebody notices. Nothing
 * here posts, edits or deletes on any platform: every call is a read.
 * TikTok has no module yet; its numbers arrive by `npm run hand`.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listQueue, type Platform, type QueueItem } from '../lib/queue.ts';
import { PLATFORM_PREFIX, sourceRef } from '../lib/links.ts';
import { readLedger, type Ledger } from '../publish/guards.ts';
import {
  SERIES_HOURS,
  TOKEN_WARN_DAYS,
  ageDays,
  ageHours,
  appendJsonl,
  dateOf,
  daysUntil,
  readJsonl,
  type AccountRow,
  type PostRow,
  type SeriesRow,
} from './metrics.ts';
import type { PlatformModule, RecentPost } from './platforms/module.ts';
import { claim } from './claim.ts';
import { writeReplies, type ReplyEntry } from './inbox.ts';

export type Flags = {
  /** the two-hourly run: posts under SERIES_HOURS old, into series.jsonl, nothing else */
  series: boolean;
  only?: Platform;
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

/** The Meta tokens whose expiry the nightly run watches; `npm run tokens` renews them. */
const TOKEN_EXPIRY = [
  ['Instagram', 'IG_TOKEN_EXPIRES'],
  ['Threads', 'THREADS_TOKEN_EXPIRES'],
] as const;

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
        if (!p || !(p in PLATFORM_PREFIX)) throw new Error('--only needs a platform, e.g. --only youtube');
        flags.only = p as Platform;
        break;
      }
      default:
        throw new Error(`unknown flag ${a}; see the header of analytics/pull.ts`);
    }
  }
  return flags;
}

type Post = { item: QueueItem; platform: Platform; id: string; posted_at: string };

/** The ledger's `at` (the real, jittered time), else the item's publish_at, else its date at midnight UTC. */
function postedAt(item: QueueItem, platform: Platform, ledger: Ledger): string {
  const row = ledger.find((r) => r.slug === item.fm.slug && r.platform === platform);
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

export async function runPull(opts: {
  now: Date;
  flags: Flags;
  dirs: Dirs;
  modules: Partial<Record<Platform, PlatformModule>>;
  log?: (line: string) => void;
}): Promise<Summary> {
  const { now, flags, dirs, modules } = opts;
  const log = opts.log ?? console.log;
  const date = dateOf(now);
  const at = now.toISOString();
  const summary: Summary = { rows: 0, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 };
  const paths = {
    posts: join(dirs.analytics, 'posts.jsonl'),
    series: join(dirs.analytics, 'series.jsonl'),
    account: join(dirs.analytics, 'account.jsonl'),
    seen: join(dirs.analytics, 'replies-seen.json'),
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
      t.failed++;
      summary.failures++;
      log(`FAIL  ${p.item.fm.slug} ${p.platform}: ${message(e)}`);
      return undefined;
    }
  }

  const finish = (): Summary => {
    for (const [platform, t] of tally) {
      if (t.ok === 0 && t.failed > 0) {
        summary.exitCode = 1;
        log(`FAIL  ${platform}: failed on every post it had`);
      }
    }
    if (!flags.series) {
      for (const [name, key] of TOKEN_EXPIRY) {
        const value = process.env[key]?.trim();
        if (!value) continue;
        const days = daysUntil(value, now);
        if (Number.isNaN(days)) {
          log(`EXPIRING ${name} token: ${key} is not a date (${value}); run npm run tokens`);
          summary.exitCode = 1;
        } else if (days <= TOKEN_WARN_DAYS) {
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
          summary.failures++;
          log(`FAIL  recent ${m.platform}: ${message(e)}`);
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
        summary.failures++;
        log(`FAIL  ${row.slug} ${p.platform} replies: ${message(e)}`);
      }
    }
  }

  // Tier 2: the account itself, one row per platform per date.
  if (flags.account) {
    const have = readJsonl<AccountRow>(paths.account);
    for (const platform of Object.keys(modules) as Platform[]) {
      const m = moduleFor(platform);
      if (!m?.account) continue;
      if (have.some((r) => r.date === date && r.platform === platform)) {
        log(`acct  ${platform}: already have ${date}`);
        continue;
      }
      try {
        const a = await m.account(date);
        const row: AccountRow = { date, at, platform, metrics: a.metrics, breakdowns: a.breakdowns, raw: a.raw };
        write(paths.account, row, `account row ${platform}`);
        summary.accountRows++;
        log(`acct  ${platform}: ${Object.keys(a.metrics).length} metrics, ${Object.keys(a.breakdowns).length} breakdowns`);
      } catch (e) {
        summary.failures++;
        log(`FAIL  account ${platform}: ${message(e)}`);
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
